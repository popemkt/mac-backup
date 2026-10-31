// The sandbox SDK: typed access to the plugin's ops from any TypeScript on the host (a bulk
// script, a TS AgentSpec), shaped like Upstash's and E2B's SDKs. It is a thin client: every method
// is one op of core/ops.ts, sent to the plugin's HTTP route, so the SDK, the CLI and the agent
// tools cannot drift (tests/ops.test.ts checks that every op has its method here).
//
//   import { Sandbox, agents } from "/etc/bb-sandbox/plugin/sdk/index.ts";
//   await using sb = await Sandbox.create({ image: { preset: "node" }, resources: { cpus: 2 } });
//   const r = await sb.exec(["node", "-e", "console.log(1 + 1)"]);
//
// It finds the server in BB_SERVER_URL and the plugin's token in BB_SANDBOX_TOKEN, or asks
// `bb plugin token sandbox`. BB_THREAD_ID and BB_PROJECT_ID (set in every bb thread) name the
// caller: its sandboxes are labelled with the thread, and agent runs become its children.
import { execFileSync } from "node:child_process";
import type { ExecResult, FileEntry } from "../core/contract.ts";
import type { SandboxRecord, SandboxState } from "../core/service.ts";
import type { AgentSpecInput, ExecRequestInput, SandboxSpecInput } from "../core/spec.ts";
import type { RunRecord, RunState } from "../core/agent/runner.ts";

export type { AgentSpecInput, ExecResult, FileEntry, RunRecord, SandboxRecord, SandboxSpecInput };

export interface ClientOptions {
  url?: string;
  token?: string;
  threadId?: string;
  projectId?: string;
}

export class SandboxError extends Error {
  readonly op: string;
  constructor(op: string, message: string) {
    super(`${op}: ${message}`);
    this.name = "SandboxError";
    this.op = op;
  }
}

let defaults: ClientOptions = {};
/** Override where the SDK connects and who it calls as. */
export function configure(options: ClientOptions): void {
  defaults = { ...defaults, ...options };
}

let cachedToken: string | undefined;
const token = (): string => {
  const explicit = defaults.token ?? process.env.BB_SANDBOX_TOKEN;
  if (explicit) return explicit;
  cachedToken ??= execFileSync(process.env.BB_CLI ?? "bb", ["plugin", "token", "sandbox"], { encoding: "utf8" }).trim();
  return cachedToken;
};

async function call<T>(op: string, input: unknown): Promise<T> {
  const base = defaults.url ?? process.env.BB_SERVER_URL;
  if (!base) throw new SandboxError(op, "no bb server: set BB_SERVER_URL (bb threads have it)");
  const response = await fetch(`${base}/api/v1/plugins/sandbox/http/op`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bb-plugin-token": token() },
    body: JSON.stringify({
      op,
      input,
      caller: {
        threadId: defaults.threadId ?? process.env.BB_THREAD_ID,
        projectId: defaults.projectId ?? process.env.BB_PROJECT_ID,
        cwd: process.cwd(),
      },
    }),
  });
  const body = (await response.json().catch(() => null)) as { ok: boolean; result?: T; error?: string } | null;
  if (!body) throw new SandboxError(op, `HTTP ${response.status}`);
  if (!body.ok) throw new SandboxError(op, body.error ?? `HTTP ${response.status}`);
  return body.result as T;
}

export class Sandbox implements AsyncDisposable {
  record: SandboxRecord;

  // Plain, not a parameter property: scripts run this file with Node's type stripping.
  private constructor(record: SandboxRecord) {
    this.record = record;
  }

  get id(): string {
    return this.record.id;
  }

  get state(): SandboxState {
    return this.record.state;
  }

  /** Create one sandbox; resolves once it can exec (or, with `wait: false`, once it is queued). */
  static async create(spec: SandboxSpecInput = {}, options: { wait?: boolean } = {}): Promise<Sandbox> {
    const record = await call<SandboxRecord>("create", { spec, wait: options.wait ?? true });
    if (record.state === "failed") throw new SandboxError("create", record.error ?? "failed");
    return new Sandbox(record);
  }

  /** Queue many; each starts as the budget allows. `await sb.ready()` before using one. */
  static async createMany(specs: SandboxSpecInput[]): Promise<Sandbox[]> {
    return (await call<SandboxRecord[]>("createMany", { specs })).map((r) => new Sandbox(r));
  }

  static async get(id: string): Promise<Sandbox> {
    return new Sandbox(await call<SandboxRecord>("get", { id }));
  }

  static async list(filter: { state?: SandboxState; label?: Record<string, string> } = {}): Promise<Sandbox[]> {
    return (await call<SandboxRecord[]>("list", filter)).map((r) => new Sandbox(r));
  }

  /** Create, run one command, destroy. */
  static async run(argv: string[], spec: SandboxSpecInput = {}, timeoutSec?: number): Promise<ExecResult & { sandbox: string }> {
    return await call("run", { spec, argv, ...(timeoutSec ? { timeoutSec } : {}) });
  }

  static async status(): Promise<unknown> {
    return await call("status", {});
  }

  /** Wait until a queued sandbox runs; throws if it failed. */
  async ready(timeoutSec = 3600): Promise<this> {
    this.record = await call<SandboxRecord>("wait", { id: this.id, timeoutSec });
    if (this.record.state !== "running") throw new SandboxError("wait", `${this.id} is ${this.record.state}${this.record.error ? `: ${this.record.error}` : ""}`);
    return this;
  }

  async refresh(): Promise<SandboxRecord> {
    this.record = await call<SandboxRecord>("get", { id: this.id });
    return this.record;
  }

  /** A string runs through `sh -c`. */
  async exec(command: string | string[], options: Omit<ExecRequestInput, "argv"> = {}): Promise<ExecResult> {
    const argv = typeof command === "string" ? ["sh", "-c", command] : command;
    return await call<ExecResult>("exec", { id: this.id, argv, ...options });
  }

  readonly files = {
    read: async (path: string): Promise<string> => (await call<{ content: string }>("readFile", { id: this.id, path })).content,
    readBytes: async (path: string): Promise<Buffer> =>
      Buffer.from((await call<{ content: string }>("readFile", { id: this.id, path, encoding: "base64" })).content, "base64"),
    write: async (path: string, content: string | Uint8Array): Promise<void> => {
      const encoding = typeof content === "string" ? "utf8" : "base64";
      const text = typeof content === "string" ? content : Buffer.from(content).toString("base64");
      await call("writeFile", { id: this.id, path, content: text, encoding });
    },
    list: async (path = "/workspace"): Promise<FileEntry[]> => await call<FileEntry[]>("listFiles", { id: this.id, path }),
  };

  readonly ports = {
    url: async (port: number): Promise<string> => (await call<{ url: string }>("previewUrl", { id: this.id, port })).url,
  };

  async snapshot(): Promise<string> {
    return (await call<{ snapshotId: string }>("snapshot", { id: this.id })).snapshotId;
  }

  /** Idempotent. The record says what was kept (a git workspace's branch). */
  async destroy(): Promise<SandboxRecord> {
    this.record = await call<SandboxRecord>("destroy", { id: this.id });
    return this.record;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.destroy();
  }
}

/** Identity, for typed AgentSpecs in TypeScript. */
export const defineAgentSpec = (spec: AgentSpecInput): AgentSpecInput => spec;

export const agents = {
  /** Run AgentSpecs: a JSON/YAML file, or specs built in code. */
  run: async (source: { file: string } | { specs: AgentSpecInput[] }, batch?: string) =>
    await call<Array<Pick<RunRecord, "id" | "batch" | "name" | "state" | "dir">>>("agentRun", { ...source, ...(batch ? { batch } : {}) }),
  list: async (filter: { batch?: string; state?: RunState } = {}) => await call<Omit<RunRecord, "spec">[]>("agentList", filter),
  get: async (runId: string) => await call<RunRecord>("agentGet", { runId }),
  cancel: async (target: { runId: string } | { batch: string }) => await call<{ cancelled: string[] }>("agentCancel", target),
};
