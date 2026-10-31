// The op table: the one home of what the plugin can do (docs/research/2026-10-31-sandboxes.md
// §9.2). Each op is declared once, with its zod input and its handler; server.ts generates the
// `bb sandbox` commands, the `sandbox_*` agent tools and the HTTP route the SDK calls from this
// table, and tests/ops.test.ts checks every op reaches all three. A command's flags are sugar over
// the same input: every command also takes the whole input as `--input <json|@file>`.
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { PluginCliOption, PluginCliPositional } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Caller, Runner } from "./agent/runner.ts";
import { expandSpec, expandSpecText } from "./agent/spec-file.ts";
import type { SandboxService } from "./service.ts";
import { type SandboxSpecInput, agentSpecSchema, execRequestSchema, sandboxSpecSchema } from "./spec.ts";

export interface OpContext {
  service: SandboxService;
  runner: Runner;
  caller: { threadId?: string; projectId?: string; cwd?: string };
  signal?: AbortSignal;
}

/** What a command's flags parsed to (defineCli's erased run input). */
export interface CliInput {
  options: Record<string, string | number | boolean | string[] | undefined>;
  positionals: Record<string, string | string[] | undefined>;
  passthrough: string[];
}

export interface Op<S extends z.ZodType = z.ZodType> {
  name: string;
  summary: string;
  input: S;
  /** Runs nothing visible to a caller but its own result (no side effect on other sandboxes). */
  run(input: z.output<S>, ctx: OpContext): Promise<unknown>;
  cli: {
    /** Invocation path under `bb sandbox`. */
    path: string;
    options?: Record<string, PluginCliOption>;
    positionals?: PluginCliPositional[];
    passthrough?: boolean;
    /** Flags to (part of) the input; `--input` fills the rest. */
    toInput?(cli: CliInput): Record<string, unknown>;
    /** How the result prints; JSON by default. */
    render?(result: unknown): { exitCode: number; stdout?: string; stderr?: string };
  };
}

const op = <S extends z.ZodType>(definition: Op<S>): Op => definition as unknown as Op;

const id = z.string().min(1);
const idPositional: PluginCliPositional[] = [{ name: "id", description: "Sandbox id (sb-…)", required: true }];

/** `k=v` pairs to a record. */
export function pairs(values: string[] | undefined, what: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const value of values ?? []) {
    const at = value.indexOf("=");
    if (at < 1) throw new Error(`${what} takes key=value, got ${value}`);
    out[value.slice(0, at)] = value.slice(at + 1);
  }
  return out;
}

/** Flags shared by `create` and `run`: the common corners of a SandboxSpec. */
const specOptions: Record<string, PluginCliOption> = {
  provider: { type: "string", description: "Provider id (default: the host policy's)" },
  preset: { type: "string", description: "Image preset from the host policy (blender, browser, node, …)" },
  nix: { type: "string", repeatable: true, split: ",", description: "nixpkgs attributes whose bin/ go on PATH" },
  git: { type: "string", description: "Workspace: a git repo (absolute path), checked out on a new branch" },
  ref: { type: "string", description: "Ref the git workspace starts at (default HEAD)" },
  branch: { type: "string", description: "Branch the git workspace's work lands on (default sandbox/<id>)" },
  bind: { type: "string", description: "Workspace: bind this host directory (absolute) read-write" },
  cpus: { type: "string", description: "CPU cores (fractions allowed; default 2)" },
  memory: { type: "integer", min: 64, max: 262144, description: "Memory in MiB (default 2048)" },
  net: { type: "enum", values: ["none", "open"], description: "Egress (default none)" },
  timeout: { type: "integer", min: 10, max: 86400, description: "Lifetime in seconds (default 1800)" },
  label: { type: "string", repeatable: true, description: "key=value label" },
  env: { type: "string", repeatable: true, description: "KEY=value environment (never secrets)" },
  priority: { type: "integer", min: -100, max: 100, description: "Higher is admitted first (default 0)" },
};

function specFromFlags(o: CliInput["options"]): Record<string, unknown> {
  const spec: Record<string, unknown> = {};
  if (o.provider) spec.provider = o.provider;
  if (o.preset) spec.image = { preset: o.preset };
  else if ((o.nix as string[] | undefined)?.length) spec.image = { nix: o.nix };
  if (o.git) spec.workspace = { git: { repo: o.git, ...(o.ref ? { ref: o.ref } : {}), ...(o.branch ? { branch: o.branch } : {}) } };
  else if (o.bind) spec.workspace = { bind: { path: o.bind } };
  const resources: Record<string, number> = {};
  if (o.cpus !== undefined) resources.cpus = Number(o.cpus);
  if (o.memory !== undefined) resources.memoryMiB = o.memory as number;
  if (Object.keys(resources).length) spec.resources = resources;
  if (o.net) spec.network = { egress: o.net };
  if (o.timeout !== undefined) spec.timeoutSec = o.timeout;
  if ((o.label as string[] | undefined)?.length) spec.labels = pairs(o.label as string[], "--label");
  if ((o.env as string[] | undefined)?.length) spec.env = pairs(o.env as string[], "--env");
  if (o.priority !== undefined) spec.priority = o.priority;
  return spec;
}

const execResult = (result: unknown) => {
  const r = result as { exitCode: number; stdout: string; stderr: string; timedOut: boolean; durationMs: number; sandbox?: string };
  const note = `[${r.sandbox ? `sandbox ${r.sandbox} · ` : ""}${r.durationMs} ms · exit ${r.exitCode}${r.timedOut ? " · timed out" : ""}]\n`;
  return { exitCode: r.exitCode, stdout: r.stdout, stderr: `${r.stderr}${r.stderr && !r.stderr.endsWith("\n") ? "\n" : ""}${note}` };
};

/** The caller's thread labels every sandbox it creates, so its sandboxes can be listed. */
const owned = (spec: SandboxSpecInput | undefined, ctx: OpContext): SandboxSpecInput =>
  ctx.caller.threadId ? { ...spec, labels: { thread: ctx.caller.threadId, ...spec?.labels } } : (spec ?? {});

const caller = (ctx: OpContext): Caller => {
  if (!ctx.caller.projectId) throw new Error("agent runs need the caller's project (run from a bb thread, or pass BB_PROJECT_ID to the SDK)");
  return { projectId: ctx.caller.projectId, ...(ctx.caller.threadId ? { threadId: ctx.caller.threadId } : {}) };
};

export const OPS: Op[] = [
  op({
    name: "create",
    summary: "Create a sandbox and wait until it can run commands (or until it is queued, with --no-wait)",
    input: z.object({ spec: sandboxSpecSchema.optional(), wait: z.boolean().default(true) }),
    async run(input, ctx) {
      const spec = owned(input.spec, ctx);
      if (input.wait) return await ctx.service.create(spec);
      return (await ctx.service.createMany([spec]))[0];
    },
    cli: {
      path: "create",
      options: { ...specOptions, "no-wait": { type: "boolean", description: "Return once queued" } },
      toInput: (c) => ({ spec: specFromFlags(c.options), wait: !c.options["no-wait"] }),
    },
  }),
  op({
    name: "createMany",
    summary: "Queue many sandboxes at once; each starts when the budget allows",
    input: z.object({ specs: z.array(sandboxSpecSchema).min(1).max(500) }),
    async run(input, ctx) {
      return await ctx.service.createMany(input.specs.map((spec) => owned(spec, ctx)));
    },
    cli: { path: "create-many" },
  }),
  op({
    name: "get",
    summary: "One sandbox's record (state, spec, queue position, outcome)",
    input: z.object({ id }),
    run: async (input, ctx) => await ctx.service.get(input.id),
    cli: { path: "get", positionals: idPositional, toInput: (c) => ({ id: c.positionals.id }) },
  }),
  op({
    name: "list",
    summary: "Sandboxes, oldest first, filtered by state and labels",
    input: z.object({ state: z.enum(["queued", "running", "destroyed", "failed"]).optional(), label: z.record(z.string(), z.string()).optional() }),
    run: async (input, ctx) => await ctx.service.list(input),
    cli: {
      path: "list",
      options: {
        state: { type: "enum", values: ["queued", "running", "destroyed", "failed"], description: "Only this state" },
        label: { type: "string", repeatable: true, description: "Only sandboxes with this key=value label" },
      },
      toInput: (c) => ({
        ...(c.options.state ? { state: c.options.state } : {}),
        ...((c.options.label as string[]).length ? { label: pairs(c.options.label as string[], "--label") } : {}),
      }),
    },
  }),
  op({
    name: "wait",
    summary: "Wait until a queued sandbox is running or failed",
    input: z.object({ id, timeoutSec: z.number().int().min(1).max(86400).default(3600) }),
    run: async (input, ctx) => await ctx.service.wait(input.id, input.timeoutSec, ctx.signal),
    cli: {
      path: "wait",
      positionals: idPositional,
      options: { timeout: { type: "integer", min: 1, max: 86400, description: "Seconds to wait (default 3600)" } },
      toInput: (c) => ({ id: c.positionals.id, ...(c.options.timeout ? { timeoutSec: c.options.timeout } : {}) }),
    },
  }),
  op({
    name: "exec",
    summary: "Run a command in a running sandbox; output is capped",
    input: execRequestSchema.extend({ id }),
    async run(input, ctx) {
      const { id: sandbox, ...request } = input;
      return await ctx.service.exec(sandbox, request, ctx.signal);
    },
    cli: {
      path: "exec",
      positionals: idPositional,
      passthrough: true,
      options: {
        cwd: { type: "string", description: "Working directory inside the sandbox (default /workspace)" },
        env: { type: "string", repeatable: true, description: "KEY=value for this command" },
        timeout: { type: "integer", min: 1, max: 86400, description: "Seconds before the command is killed" },
      },
      toInput: (c) => ({
        id: c.positionals.id,
        argv: c.passthrough,
        ...(c.options.cwd ? { cwd: c.options.cwd } : {}),
        env: pairs(c.options.env as string[], "--env"),
        ...(c.options.timeout ? { timeoutSec: c.options.timeout } : {}),
      }),
      render: execResult,
    },
  }),
  op({
    name: "run",
    summary: "Create a sandbox, run one command in it, destroy it",
    input: z.object({ spec: sandboxSpecSchema.optional(), argv: z.array(z.string()).min(1), timeoutSec: z.number().int().min(1).optional() }),
    async run(input, ctx) {
      const box = await ctx.service.create(owned(input.spec, ctx));
      if (box.state !== "running") throw new Error(`sandbox ${box.id} ${box.state}: ${box.error ?? ""}`);
      try {
        const result = await ctx.service.exec(box.id, { argv: input.argv, ...(input.timeoutSec ? { timeoutSec: input.timeoutSec } : {}) }, ctx.signal);
        return { ...result, sandbox: box.id };
      } finally {
        await ctx.service.destroy(box.id);
      }
    },
    cli: {
      path: "run",
      passthrough: true,
      options: specOptions,
      toInput: (c) => ({ spec: specFromFlags(c.options), argv: c.passthrough }),
      render: execResult,
    },
  }),
  op({
    name: "readFile",
    summary: "Read a file under /workspace",
    input: z.object({ id, path: z.string().min(1), encoding: z.enum(["utf8", "base64"]).default("utf8") }),
    async run(input, ctx) {
      const data = Buffer.from(await ctx.service.readFile(input.id, input.path));
      return { path: input.path, encoding: input.encoding, content: data.toString(input.encoding) };
    },
    cli: {
      path: "read",
      positionals: [...idPositional, { name: "path", description: "Path under /workspace", required: true }],
      options: { base64: { type: "boolean", description: "Print base64 (for binary files)" } },
      toInput: (c) => ({ id: c.positionals.id, path: c.positionals.path, encoding: c.options.base64 ? "base64" : "utf8" }),
      render: (r) => ({ exitCode: 0, stdout: (r as { content: string }).content }),
    },
  }),
  op({
    name: "writeFile",
    summary: "Write a file under /workspace (parents are created)",
    input: z.object({ id, path: z.string().min(1), content: z.string().max(8 * 1024 * 1024), encoding: z.enum(["utf8", "base64"]).default("utf8") }),
    async run(input, ctx) {
      await ctx.service.writeFile(input.id, input.path, Buffer.from(input.content, input.encoding));
      return { path: input.path, bytes: Buffer.byteLength(input.content, input.encoding) };
    },
    cli: {
      path: "write",
      positionals: [...idPositional, { name: "path", description: "Path under /workspace", required: true }],
      options: {
        content: { type: "string", stdin: true, description: "File content (--content-stdin reads it from stdin)" },
        base64: { type: "boolean", description: "Content is base64" },
      },
      toInput: (c) => ({
        id: c.positionals.id,
        path: c.positionals.path,
        ...(c.options.content !== undefined ? { content: c.options.content } : {}),
        encoding: c.options.base64 ? "base64" : "utf8",
      }),
    },
  }),
  op({
    name: "listFiles",
    summary: "List a directory under /workspace",
    input: z.object({ id, path: z.string().default("/workspace") }),
    run: async (input, ctx) => await ctx.service.listFiles(input.id, input.path),
    cli: {
      path: "ls",
      positionals: [...idPositional, { name: "path", description: "Directory (default /workspace)" }],
      toInput: (c) => ({ id: c.positionals.id, ...(c.positionals.path ? { path: c.positionals.path } : {}) }),
    },
  }),
  op({
    name: "previewUrl",
    summary: "A URL for a port the sandbox listens on (providers with ports only)",
    input: z.object({ id, port: z.number().int().min(1).max(65535) }),
    run: async (input, ctx) => ({ url: await ctx.service.previewUrl(input.id, input.port) }),
    cli: {
      path: "port",
      positionals: [...idPositional, { name: "port", description: "Port inside the sandbox", required: true }],
      toInput: (c) => ({ id: c.positionals.id, port: Number(c.positionals.port) }),
    },
  }),
  op({
    name: "snapshot",
    summary: "Snapshot the workspace and home; create from it with workspace {snapshot: <id>}",
    input: z.object({ id }),
    run: async (input, ctx) => await ctx.service.snapshot(input.id),
    cli: { path: "snapshot", positionals: idPositional, toInput: (c) => ({ id: c.positionals.id }) },
  }),
  op({
    name: "destroy",
    summary: "Destroy a sandbox (or drop it from the queue); a git workspace's branch is kept",
    input: z.object({ id }),
    run: async (input, ctx) => await ctx.service.destroy(input.id),
    cli: { path: "destroy", positionals: idPositional, toInput: (c) => ({ id: c.positionals.id }) },
  }),
  op({
    name: "status",
    summary: "Queue (running, waiting, budget in use, pressure) and each provider's capabilities",
    input: z.object({}),
    run: async (_input, ctx) => ctx.service.status(),
    cli: { path: "status" },
  }),
  op({
    name: "agentRun",
    summary: "Run AgentSpecs (a JSON/YAML file, or specs): one sandbox and one agent thread per run, through the queue",
    input: z
      .object({
        file: z.string().optional(),
        specs: z.array(agentSpecSchema).max(500).optional(),
        batch: z.string().optional(),
      })
      .refine((i) => (i.file === undefined) !== (i.specs === undefined), "exactly one of file, specs"),
    async run(input, ctx) {
      const base = ctx.caller.cwd ?? process.cwd();
      let specs;
      if (input.file) {
        const path = isAbsolute(input.file) ? input.file : resolve(base, input.file);
        specs = await expandSpecText(await readFile(path, "utf8"), path);
      } else {
        specs = [];
        for (const raw of input.specs ?? []) specs.push(...(await expandSpec(raw, base)));
      }
      const runs = await ctx.runner.submit(specs, caller(ctx), input.batch);
      return runs.map((r) => ({ id: r.id, batch: r.batch, name: r.name, state: r.state, dir: r.dir }));
    },
    cli: {
      path: "agent run",
      positionals: [{ name: "file", description: "AgentSpec file (JSON or YAML)" }],
      options: { batch: { type: "string", description: "Batch name (default: the first spec's name)" } },
      toInput: (c) => ({ ...(c.positionals.file ? { file: c.positionals.file } : {}), ...(c.options.batch ? { batch: c.options.batch } : {}) }),
    },
  }),
  op({
    name: "agentList",
    summary: "Agent runs, oldest first: state, branch, sensors, reward, tokens",
    input: z.object({ batch: z.string().optional(), state: z.enum(["queued", "running", "sensing", "done", "failed", "cancelled"]).optional() }),
    async run(input, ctx) {
      return (await ctx.runner.list(input)).map(({ spec: _spec, ...summary }) => ({
        ...summary,
        sensors: summary.sensors?.map(({ tail: _tail, ...s }) => s),
      }));
    },
    cli: {
      path: "agent list",
      options: {
        batch: { type: "string", description: "Only this batch" },
        state: { type: "enum", values: ["queued", "running", "sensing", "done", "failed", "cancelled"], description: "Only this state" },
      },
      toInput: (c) => ({ ...(c.options.batch ? { batch: c.options.batch } : {}), ...(c.options.state ? { state: c.options.state } : {}) }),
    },
  }),
  op({
    name: "agentGet",
    summary: "One agent run's full record; its files (trajectory.json, patch.diff, artifacts/) are under dir",
    input: z.object({ runId: z.string().min(1) }),
    run: async (input, ctx) => await ctx.runner.get(input.runId),
    cli: { path: "agent get", positionals: [{ name: "runId", description: "Run id (run-…)", required: true }], toInput: (c) => ({ runId: c.positionals.runId }) },
  }),
  op({
    name: "agentCancel",
    summary: "Cancel a run, or every unfinished run of a batch",
    input: z
      .object({ runId: z.string().optional(), batch: z.string().optional() })
      .refine((i) => (i.runId === undefined) !== (i.batch === undefined), "exactly one of runId, batch"),
    run: async (input, ctx) => ({ cancelled: await ctx.runner.cancel(input) }),
    cli: {
      path: "agent cancel",
      positionals: [{ name: "runId", description: "Run id (or use --batch)" }],
      options: { batch: { type: "string", description: "Cancel every unfinished run of this batch" } },
      toInput: (c) => ({ ...(c.positionals.runId ? { runId: c.positionals.runId } : {}), ...(c.options.batch ? { batch: c.options.batch } : {}) }),
    },
  }),
];

export const opByName = (name: string): Op | undefined => OPS.find((o) => o.name === name);

/** The agent tool name of an op: sandbox_exec, sandbox_agent_run, … */
export const toolName = (name: string) => `sandbox_${name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;

/** Validate and run; the one entry every surface goes through. */
export async function invoke(o: Op, input: unknown, ctx: OpContext): Promise<unknown> {
  return await o.run(o.input.parse(input ?? {}), ctx);
}

/** `--input <json|@file>`: the whole input, or the base the flags override. */
export async function readInputFlag(value: string | undefined, cwd: string | undefined): Promise<Record<string, unknown>> {
  if (!value) return {};
  const text = value.startsWith("@") ? await readFile(resolve(cwd ?? process.cwd(), value.slice(1)), "utf8") : value;
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("--input must be a JSON object");
  return parsed as Record<string, unknown>;
}
