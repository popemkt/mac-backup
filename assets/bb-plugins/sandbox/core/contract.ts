// The one sandbox contract every provider implements (docs/research/2026-10-31-sandboxes.md →
// Contract). Verbs follow the E2B, Upstash Box and OpenSandbox SDKs: create, exec, files, ports,
// pause/snapshot, destroy. A provider declares what it supports in `capabilities`; callers check a
// capability before using an optional verb, and an unsupported verb throws `SandboxUnsupported`.

/** Egress: none, an allowlist of host[:port] names, or open. Default is none. */
export type NetworkPolicy =
  | { egress: "none" }
  | { egress: "allowlist"; hosts: string[] }
  | { egress: "open" };

export interface Limits {
  /** Whole or fractional cores. */
  cpus: number;
  memoryMiB: number;
  /** Process count cap (fork bombs). */
  pids: number;
  /** Wall-clock lifetime of the sandbox; it is destroyed after this. */
  timeoutSec: number;
  /** Writable disk the sandbox may use; providers that cannot cap it report so. */
  diskMiB?: number;
}

export interface SandboxSpec {
  /** Provider image or template; the local providers use the host's read-only /nix/store. */
  image?: string;
  limits: Limits;
  network: NetworkPolicy;
  /** Plain environment. Secrets never go here: they are named in `secrets` and resolved by the plugin. */
  env?: Record<string, string>;
  /** Names of secrets from the plugin's allowlist to inject; empty by default. */
  secrets?: string[];
  /** Ports the sandbox will serve, for preview URLs. */
  ports?: number[];
  /** Free-form labels (threadId, jobId) for list and cleanup. */
  labels?: Record<string, string>;
}

export interface ExecRequest {
  /** argv; no shell unless the caller passes one (["sh", "-c", "…"]). */
  argv: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutSec?: number;
  stdin?: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** True when the exec hit its timeout (or the sandbox's) and was killed. */
  timedOut: boolean;
  durationMs: number;
}

export interface SandboxInfo {
  id: string;
  provider: string;
  state: "running" | "paused" | "destroyed";
  createdAt: string;
  expiresAt: string;
  labels: Record<string, string>;
}

export interface Capabilities {
  /** Isolation class, strongest last: namespaces < user-space kernel < microVM. */
  isolation: "namespaces" | "gvisor" | "microvm";
  /** Which limits the provider enforces; the rest are advisory and reported. */
  enforces: Array<keyof Limits>;
  egress: Array<NetworkPolicy["egress"]>;
  ports: boolean;
  pause: boolean;
  snapshot: boolean;
}

export interface SandboxProvider {
  readonly id: string;
  readonly capabilities: Capabilities;
  create(spec: SandboxSpec, signal?: AbortSignal): Promise<SandboxInfo>;
  exec(id: string, request: ExecRequest, signal?: AbortSignal): Promise<ExecResult>;
  readFile(id: string, path: string): Promise<Uint8Array>;
  writeFile(id: string, path: string, data: Uint8Array | string): Promise<void>;
  list(labels?: Record<string, string>): Promise<SandboxInfo[]>;
  /** URL that reaches `port` inside the sandbox; requires capabilities.ports. */
  previewUrl?(id: string, port: number): Promise<string>;
  pause?(id: string): Promise<void>;
  resume?(id: string): Promise<void>;
  snapshot?(id: string): Promise<{ snapshotId: string }>;
  destroy(id: string): Promise<void>;
}

export class SandboxUnsupported extends Error {
  constructor(provider: string, verb: string) {
    super(`${provider} does not support ${verb}`);
    this.name = "SandboxUnsupported";
  }
}

export const DEFAULT_LIMITS: Limits = { cpus: 2, memoryMiB: 2048, pids: 512, timeoutSec: 600 };
