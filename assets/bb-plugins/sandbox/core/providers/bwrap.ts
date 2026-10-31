// The minimal local provider: bubblewrap (unprivileged user namespaces), no daemon, no root.
// Each sandbox is a directory on the host, mounted as /workspace, with the host's /nix/store and
// system profile read-only and nothing else of the host visible: no /home, no ~/.ssh, no bb data.
// It isolates files, processes and (with egress "none") the network, but shares the host kernel,
// so it is for semi-trusted code, not hostile code (docs/research/2026-10-31-sandboxes.md →
// Providers).
//
// Limits: without cgroup delegation (shared-server's bb units have none) it can enforce only the
// lifetime and per-exec timeouts, and runs every process at nice 19. With `cgroups: true` it runs
// each exec in a transient `systemd-run --user --scope` with MemoryMax, CPUQuota and TasksMax,
// which needs the person's user manager (linger) — the doc's proposed host change.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { constants } from "node:os";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  type Capabilities,
  type ExecRequest,
  type ExecResult,
  type Limits,
  type SandboxInfo,
  type SandboxProvider,
  type SandboxSpec,
  SandboxUnsupported,
} from "../contract.ts";

export interface BwrapOptions {
  /** Where sandbox directories live (the plugin's data directory). */
  root: string;
  /** The bwrap binary. */
  bwrap: string;
  /** Wrap execs in `systemd-run --user --scope` for cgroup limits. */
  cgroups: boolean;
  /** Cap on captured stdout and stderr, each. */
  outputMaxBytes: number;
}

const WORKSPACE = "/workspace";
const HOME = "/home/sandbox";
/** Host files a sandbox with egress needs to resolve names and verify TLS. */
const NETWORK_ETC = ["/etc/resolv.conf", "/etc/hosts", "/etc/ssl", "/etc/static/ssl", "/etc/nsswitch.conf"];

interface Record_ {
  spec: SandboxSpec;
  info: SandboxInfo;
  timer: ReturnType<typeof setTimeout>;
}

/** bwrap arguments for one exec; pure, so tests can check the isolation flags. */
export function bwrapArgs(dir: string, spec: SandboxSpec, request: ExecRequest): string[] {
  const args = [
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--hostname",
    "sandbox",
    "--ro-bind",
    "/nix/store",
    "/nix/store",
    "--ro-bind",
    "/run/current-system/sw",
    "/run/current-system/sw",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--bind",
    join(dir, "work"),
    WORKSPACE,
    "--bind",
    join(dir, "home"),
    HOME,
    "--chdir",
    request.cwd ?? WORKSPACE,
    "--clearenv",
    "--setenv",
    "PATH",
    "/run/current-system/sw/bin",
    "--setenv",
    "HOME",
    HOME,
  ];
  if (spec.network.egress === "open") {
    args.push("--share-net");
    for (const path of NETWORK_ETC) if (existsSync(path)) args.push("--ro-bind", path, path);
  }
  for (const [key, value] of Object.entries({ ...spec.env, ...request.env })) args.push("--setenv", key, value);
  args.push("--", ...request.argv);
  return args;
}

/** systemd-run properties for a cgroup-capped exec. */
export function scopeArgs(limits: Limits): string[] {
  return [
    "--user",
    "--scope",
    "--quiet",
    "--collect",
    "-p",
    `MemoryMax=${limits.memoryMiB}M`,
    "-p",
    "MemorySwapMax=0",
    "-p",
    `CPUQuota=${Math.round(limits.cpus * 100)}%`,
    "-p",
    `TasksMax=${limits.pids}`,
  ];
}

export function createBwrapProvider(options: BwrapOptions): SandboxProvider {
  const sandboxes = new Map<string, Record_>();
  const capabilities: Capabilities = {
    isolation: "namespaces",
    enforces: options.cgroups ? ["cpus", "memoryMiB", "pids", "timeoutSec"] : ["timeoutSec"],
    egress: ["none", "open"],
    ports: false,
    pause: false,
    snapshot: false,
  };

  const get = (id: string): Record_ => {
    const record = sandboxes.get(id);
    if (!record) throw new Error(`no sandbox ${id}`);
    return record;
  };

  /**
   * The host path for an in-sandbox path under /workspace. The plugin reads and writes it with the
   * plugin's own rights, so it refuses `..` escapes and any symlink the sandbox may have planted
   * on the way (the real path must stay inside the sandbox's work directory).
   */
  const hostPath = async (id: string, path: string, forWrite: boolean): Promise<string> => {
    const work = await realpath(join(options.root, id, "work"));
    const rel = relative(WORKSPACE, resolve(WORKSPACE, path));
    if (rel === "" || rel.startsWith("..")) throw new Error(`path ${path} is not a file under ${WORKSPACE}`);
    const target = join(work, rel);
    const inside = (p: string) => p.startsWith(`${work}/`);
    if (forWrite) {
      await mkdir(dirname(target), { recursive: true });
      if (!inside(`${await realpath(dirname(target))}/`)) throw new Error(`path ${path} leaves ${WORKSPACE}`);
      const existing = await lstat(target).catch(() => null);
      if (existing?.isSymbolicLink()) throw new Error(`path ${path} is a symlink`);
    } else if (!inside(await realpath(target))) {
      throw new Error(`path ${path} leaves ${WORKSPACE}`);
    }
    return target;
  };

  const destroy = async (id: string) => {
    const record = sandboxes.get(id);
    if (record) {
      clearTimeout(record.timer);
      record.info.state = "destroyed";
      sandboxes.delete(id);
    }
    await rm(join(options.root, id), { recursive: true, force: true });
  };

  return {
    id: "bwrap",
    capabilities,

    async create(spec) {
      if (!capabilities.egress.includes(spec.network.egress)) throw new SandboxUnsupported("bwrap", `egress ${spec.network.egress}`);
      if (spec.ports?.length) throw new SandboxUnsupported("bwrap", "ports");
      if (spec.secrets?.length) throw new SandboxUnsupported("bwrap", "secrets (not wired in the proof of concept)");
      const id = `sbx-${randomUUID().slice(0, 8)}`;
      const dir = join(options.root, id);
      await mkdir(join(dir, "work"), { recursive: true });
      await mkdir(join(dir, "home"), { recursive: true });
      const now = Date.now();
      const info: SandboxInfo = {
        id,
        provider: "bwrap",
        state: "running",
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + spec.limits.timeoutSec * 1000).toISOString(),
        labels: spec.labels ?? {},
      };
      const timer = setTimeout(() => void destroy(id), spec.limits.timeoutSec * 1000);
      timer.unref?.();
      sandboxes.set(id, { spec, info, timer });
      return info;
    },

    async exec(id, request, signal) {
      const { spec, info } = get(id);
      const remainingSec = Math.max(1, (Date.parse(info.expiresAt) - Date.now()) / 1000);
      const timeoutSec = Math.min(request.timeoutSec ?? remainingSec, remainingSec);
      const inner = ["nice", "-n", "19", options.bwrap, ...bwrapArgs(join(options.root, id), spec, request)];
      const argv = options.cgroups ? ["systemd-run", ...scopeArgs(spec.limits), ...inner] : inner;
      const started = Date.now();
      return await new Promise<ExecResult>((done, fail) => {
        const child = spawn(argv[0], argv.slice(1), { stdio: ["pipe", "pipe", "pipe"], detached: true });
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        let outBytes = 0;
        let errBytes = 0;
        let timedOut = false;
        const kill = () => {
          // The whole process group: bwrap and everything under it.
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              // already gone
            }
          }
        };
        const timer = setTimeout(() => {
          timedOut = true;
          kill();
        }, timeoutSec * 1000);
        signal?.addEventListener("abort", kill, { once: true });
        child.stdout.on("data", (chunk: Buffer) => {
          if (outBytes < options.outputMaxBytes) out.push(chunk);
          outBytes += chunk.length;
        });
        child.stderr.on("data", (chunk: Buffer) => {
          if (errBytes < options.outputMaxBytes) err.push(chunk);
          errBytes += chunk.length;
        });
        child.on("error", (error) => {
          clearTimeout(timer);
          fail(error);
        });
        child.on("close", (code, sig) => {
          clearTimeout(timer);
          const clip = (parts: Buffer[], total: number) => {
            const text = Buffer.concat(parts).subarray(0, options.outputMaxBytes).toString("utf8");
            return total > options.outputMaxBytes ? `${text}\n[… ${total - options.outputMaxBytes} more bytes]` : text;
          };
          done({
            exitCode: code ?? 128 + (sig ? constants.signals[sig] : 0),
            stdout: clip(out, outBytes),
            stderr: clip(err, errBytes),
            timedOut,
            durationMs: Date.now() - started,
          });
        });
        child.stdin.end(request.stdin ?? "");
      });
    },

    async readFile(id, path) {
      get(id);
      return await readFile(await hostPath(id, path, false));
    },

    async writeFile(id, path, data) {
      get(id);
      await writeFile(await hostPath(id, path, true), data);
    },

    async list(labels) {
      const known = [...sandboxes.values()].map((r) => r.info);
      // Directories left by a previous load (a reload or restart) are orphans: report them so
      // cleanup can find them.
      const dirs = existsSync(options.root) ? await readdir(options.root) : [];
      const orphans: SandboxInfo[] = dirs
        .filter((d) => d.startsWith("sbx-") && !sandboxes.has(d))
        .map((d) => ({ id: d, provider: "bwrap", state: "destroyed", createdAt: "", expiresAt: "", labels: {} }));
      return [...known, ...orphans].filter((info) =>
        Object.entries(labels ?? {}).every(([key, value]) => info.labels[key] === value),
      );
    },

    destroy,
  };
}
