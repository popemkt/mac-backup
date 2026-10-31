// The shape of everything a caller asks for: a sandbox, an exec, an agent run. These schemas are
// the one home of that shape (docs/research/2026-10-31-sandboxes.md §9.4, §10); the CLI, the
// agent tools, the HTTP route and the SDK all validate against them, and the TypeScript types are
// inferred from them.
import { z } from "zod";

const name = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/, "letters, digits, . _ - (at most 64)");
const absolute = z.string().startsWith("/", "an absolute path");
const labels = z.record(z.string().max(64), z.string().max(256));

export const imageSchema = z.union([
  z.object({ nix: z.array(z.string().regex(/^[a-zA-Z0-9_.-]+$/, "a nixpkgs attribute")).min(1).max(32) }).strict(),
  z.object({ preset: name }).strict(),
  z.object({ oci: z.string().min(1) }).strict(),
]);

export const workspaceSchema = z.union([
  z.object({ empty: z.literal(true) }).strict(),
  z
    .object({
      git: z
        .object({
          repo: absolute,
          ref: z.string().min(1).default("HEAD"),
          /** The branch the sandbox's work lands on; new, created at `ref`. */
          branch: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/).optional(),
          /** Where execs start, relative to the repo root. */
          subdir: z.string().regex(/^(?!\/)(?!.*\.\.).*$/, "relative, without ..").optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ bind: z.object({ path: absolute, readOnly: z.boolean().default(false) }).strict() }).strict(),
  z.object({ snapshot: z.string().min(1) }).strict(),
]);

export const resourcesSchema = z
  .object({
    cpus: z.number().positive().max(64).default(2),
    memoryMiB: z.number().int().min(64).max(262144).default(2048),
    pids: z.number().int().min(16).max(65536).default(1024),
    diskMiB: z.number().int().positive().optional(),
    gpus: z.number().int().min(0).max(8).optional(),
  })
  .strict();

export const networkSchema = z.discriminatedUnion("egress", [
  z.object({ egress: z.literal("none") }).strict(),
  z.object({ egress: z.literal("open") }).strict(),
  z.object({ egress: z.literal("allowlist"), hosts: z.array(z.string().min(1)).min(1).max(256) }).strict(),
]);

export const storageSchema = z
  .object({
    /** Persistent named directories, kept across sandboxes. */
    volumes: z.array(z.object({ name, mount: absolute, readOnly: z.boolean().default(false) }).strict()).max(16).default([]),
    /** Host data mounted in, read-only unless said otherwise. */
    data: z.array(z.object({ source: absolute, mount: absolute, readOnly: z.boolean().default(true) }).strict()).max(16).default([]),
  })
  .strict();

export const sandboxSpecSchema = z
  .object({
    /** One field switches backends; omitted means the host policy's default provider. */
    provider: z.string().optional(),
    image: imageSchema.optional(),
    workspace: workspaceSchema.default({ empty: true }),
    resources: resourcesSchema.default(resourcesSchema.parse({})),
    network: networkSchema.default({ egress: "none" }),
    storage: storageSchema.default(storageSchema.parse({})),
    /** Plain environment; never secrets. */
    env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).default({}),
    /** Names of secrets to inject at the provider's egress; refused by providers that cannot. */
    secrets: z.array(name).default([]),
    /** The sandbox's whole lifetime. */
    timeoutSec: z.number().int().min(10).max(86400).default(1800),
    labels: labels.default({}),
    /** Higher is admitted first. */
    priority: z.number().int().min(-100).max(100).default(0),
  })
  .strict();

export const execRequestSchema = z
  .object({
    argv: z.array(z.string()).min(1),
    cwd: absolute.optional(),
    env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).default({}),
    timeoutSec: z.number().int().min(1).max(86400).optional(),
    stdin: z.string().max(1024 * 1024).optional(),
  })
  .strict();

// AgentSpec: one agent run, declared (§10).

const interpolated = z.string();

export const sensorSchema = z
  .object({
    name,
    run: z.array(interpolated).min(1),
    kind: z.enum(["check", "test", "screenshot", "eval"]).default("check"),
    timeoutSec: z.number().int().min(1).max(7200).default(600),
    /** Files under /workspace (globs) kept as this sensor's artifacts. */
    artifacts: z.array(interpolated).default([]),
  })
  .strict();

export const guideSchema = z.union([
  z.object({ file: interpolated, as: z.string().optional() }).strict(),
  z.object({ skill: interpolated }).strict(),
]);

/** Fable models are never used for agent runs (the owner's rule). */
const notFable = (model: string) => !/fable/i.test(model);

export const agentSpecSchema = z
  .object({
    schema: z.literal("bb-sandbox/agent-spec@1"),
    name: interpolated,
    labels: labels.default({}),
    /**
     * Fan-out: one run per combination of values; `${key}` in strings is substituted. A value is a
     * list, or `{ dirs: "<path>" }`: the directories at that path in the workspace repo at its ref.
     */
    matrix: z
      .record(
        z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
        z.union([z.array(z.string()).min(1), z.object({ dirs: z.string() }).strict()]),
      )
      .optional(),
    priority: z.number().int().min(-100).max(100).default(0),
    agent: z
      .object({
        /** A bb provider id (claude-code, codex, acp-opencode, pi, …). */
        harness: z.string().min(1),
        model: z.string().min(1).refine(notFable, "Fable models are not used for agent runs"),
        effort: z.string().optional(),
        timeoutSec: z.number().int().min(60).max(86400).default(3600),
      })
      .strict(),
    instructions: z
      .object({
        prompt: interpolated.optional(),
        promptFile: interpolated.optional(),
        guides: z.array(guideSchema).default([]),
      })
      .strict()
      .refine((i) => (i.prompt === undefined) !== (i.promptFile === undefined), "exactly one of prompt, promptFile"),
    sensors: z.array(sensorSchema).default([]),
    sandbox: sandboxSpecSchema.omit({ workspace: true, priority: true, labels: true }).default(
      sandboxSpecSchema.omit({ workspace: true, priority: true, labels: true }).parse({}),
    ),
    workspace: z
      .object({
        git: z
          .object({
            repo: z.string().min(1),
            ref: z.string().min(1).default("HEAD"),
            subdir: interpolated.optional(),
          })
          .strict(),
      })
      .strict(),
    outputs: z
      .object({
        branch: interpolated.optional(),
        artifacts: z.array(interpolated).default([]),
      })
      .strict()
      .default({ artifacts: [] }),
  })
  .strict();

export type Image = z.infer<typeof imageSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type Resources = z.infer<typeof resourcesSchema>;
export type NetworkPolicy = z.infer<typeof networkSchema>;
export type SandboxSpec = z.infer<typeof sandboxSpecSchema>;
export type SandboxSpecInput = z.input<typeof sandboxSpecSchema>;
export type ExecRequest = z.infer<typeof execRequestSchema>;
export type ExecRequestInput = z.input<typeof execRequestSchema>;
export type Sensor = z.infer<typeof sensorSchema>;
export type AgentSpec = z.infer<typeof agentSpecSchema>;
export type AgentSpecInput = z.input<typeof agentSpecSchema>;
