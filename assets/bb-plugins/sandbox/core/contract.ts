// The provider contract: what every sandbox backend promises (docs/research/2026-10-31-sandboxes.md
// §9.4). The promises are checked once, over every provider, by tests/contract.test.ts; a provider
// states what it supports in `capabilities` and refuses the rest at `create` with
// `SandboxUnsupported`, never running with less than was asked.
import type { ExecRequest, Image, NetworkPolicy, SandboxSpec, Workspace } from "./spec.ts";

export interface Capabilities {
  /** Strongest last: namespaces < gvisor < microvm. */
  isolation: "namespaces" | "gvisor" | "microvm";
  images: Array<KeysOfUnion<Image>>;
  workspaces: Array<KeysOfUnion<Workspace>>;
  egress: Array<NetworkPolicy["egress"]>;
  /** Limits the provider enforces; any other requested limit is refused. */
  enforces: Array<keyof SandboxSpec["resources"]>;
  ports: boolean;
  pause: boolean;
  snapshot: boolean;
  /** "header": secrets are injected at the egress and never enter the sandbox. */
  secrets: "none" | "header";
}

/** Every key of every member of a union (`keyof` alone gives only the shared ones). */
type KeysOfUnion<T> = T extends unknown ? keyof T : never;

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface FileEntry {
  path: string;
  type: "file" | "dir" | "symlink";
  size: number;
}

/** What `destroy` leaves behind for the caller, e.g. a git workspace's branch. */
export interface Outcome {
  branch?: { repo: string; name: string; commit: string | null };
}

export interface SandboxProvider {
  readonly id: string;
  readonly capabilities: Capabilities;
  /** Create sandbox `id` (the service names it) and wait until it can exec. */
  create(id: string, spec: SandboxSpec, signal?: AbortSignal): Promise<void>;
  exec(id: string, request: ExecRequest, signal?: AbortSignal): Promise<ExecResult>;
  readFile(id: string, path: string): Promise<Uint8Array>;
  writeFile(id: string, path: string, data: Uint8Array): Promise<void>;
  listFiles(id: string, path: string): Promise<FileEntry[]>;
  /** Where a host-side agent edits the workspace, when the provider's workspace is on the host. */
  hostWorkspace?(id: string): string | null;
  previewUrl?(id: string, port: number): Promise<string>;
  pause?(id: string): Promise<void>;
  resume?(id: string): Promise<void>;
  snapshot?(id: string): Promise<{ snapshotId: string }>;
  /** Total and idempotent: afterwards `list` no longer reports `id`. */
  destroy(id: string): Promise<Outcome>;
  /** Ids the provider still holds, for reconciliation after a restart. */
  list(): Promise<string[]>;
}

export class SandboxUnsupported extends Error {
  constructor(provider: string, what: string) {
    super(`${provider} does not support ${what}`);
    this.name = "SandboxUnsupported";
  }
}

export class SandboxNotFound extends Error {
  constructor(id: string) {
    super(`no sandbox ${id}`);
    this.name = "SandboxNotFound";
  }
}

/** Refuse what `capabilities` does not cover; every provider calls this first in `create`. */
export function assertSupported(provider: SandboxProvider, spec: SandboxSpec): void {
  const caps = provider.capabilities;
  const refuse = (what: string) => {
    throw new SandboxUnsupported(provider.id, what);
  };
  if (spec.image) {
    const kind = Object.keys(spec.image)[0] as KeysOfUnion<Image>;
    if (!caps.images.includes(kind)) refuse(`${kind} images`);
  }
  const workspace = Object.keys(spec.workspace)[0] as KeysOfUnion<Workspace>;
  if (!caps.workspaces.includes(workspace)) refuse(`${workspace} workspaces`);
  if (!caps.egress.includes(spec.network.egress)) refuse(`egress ${spec.network.egress}`);
  if (spec.secrets.length > 0 && caps.secrets === "none") refuse("secrets");
  const { diskMiB, gpus } = spec.resources;
  if (diskMiB !== undefined && !caps.enforces.includes("diskMiB")) refuse("a disk limit");
  if (gpus !== undefined && gpus > 0 && !caps.enforces.includes("gpus")) refuse("GPUs");
}
