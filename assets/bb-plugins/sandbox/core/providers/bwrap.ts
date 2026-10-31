// The local provider: bubblewrap (unprivileged user namespaces), no daemon (docs/research/
// 2026-10-31-sandboxes.md §9.5). A sandbox is a directory: its workspace is bound at /workspace,
// its own home at /home/sandbox, the host's /nix/store and system profile read-only, and nothing
// else of the host is visible. Processes live for one exec: each exec is a fresh bwrap over the
// same directories, killed with its process group when it returns, and execs in one sandbox run
// one at a time, so the exec's cgroup caps are the sandbox's caps.
//
// With a slice in the host policy every exec runs as a transient service of the person's user
// manager (`systemd-run --user --pipe --wait --slice=…`), capped at the sandbox's resources under
// the slice's ceiling and outside bb's process tree. A service, not a scope: a scope would have to
// move this process out of bb's system cgroup into the user manager's tree, which cgroup v2 refuses
// an unprivileged writer; a service is forked by the user manager itself. It needs that manager
// running without a login session (linger). It shares the host kernel: a seatbelt for generated
// code, not a vault for hostile code.
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { constants, homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  type Capabilities,
  type ExecResult,
  type FileEntry,
  type Outcome,
  type SandboxProvider,
  SandboxNotFound,
  SandboxUnsupported,
  assertSupported,
} from "../contract.ts";
import type { ExecRequest, Resources, SandboxSpec } from "../spec.ts";

const run = promisify(execFile);

export const WORKSPACE = "/workspace";
export const HOME = "/home/sandbox";
const SYSTEM_BIN = "/run/current-system/sw/bin";
/** Host files a sandbox with open egress needs to resolve names and verify TLS. */
const NETWORK_ETC = ["/etc/resolv.conf", "/etc/hosts", "/etc/ssl", "/etc/static/ssl", "/etc/nsswitch.conf"];

export interface BwrapOptions {
  /** State directory: sandboxes/, volumes/, snapshots/. */
  root: string;
  bwrap: string;
  /** nixpkgs source for `nix` images; null refuses them. */
  nixpkgs: string | null;
  images: Record<string, string[]>;
  /** User slice for cgroup caps; null runs without (and says so in capabilities). */
  slice: string | null;
  outputMaxBytes: number;
}

/** Everything an exec needs, written at create so the sandbox outlives the process that made it. */
interface Meta {
  id: string;
  spec: SandboxSpec;
  /** Host directory bound at /workspace. */
  work: string;
  /** Directory execs start in. */
  cwd: string;
  /** Paths kept read-only inside the workspace (.git, the repo's hooks path). */
  masks: string[];
  mounts: Array<{ source: string; target: string; readOnly: boolean }>;
  path: string[];
  git?: { repo: string; branch: string };
}

/** Refuse binding the root, the home directory or anything above it. */
export function assertBindable(path: string): void {
  const target = resolve(path);
  const home = resolve(homedir());
  if (target === "/" || home === target || home.startsWith(`${target}/`)) {
    throw new Error(`refusing to mount ${path}: it is the root, the home directory or above it`);
  }
}

/** bwrap's arguments for one exec; pure, so the contract tests can read the isolation flags. */
export function bwrapArgs(dir: string, meta: Meta, request: ExecRequest): string[] {
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
    meta.work,
    WORKSPACE,
  ];
  for (const mask of meta.masks) args.push("--ro-bind", join(meta.work, mask), join(WORKSPACE, mask));
  args.push("--bind", join(dir, "home"), HOME);
  for (const m of meta.mounts) args.push(m.readOnly ? "--ro-bind" : "--bind", m.source, m.target);
  if (meta.spec.network.egress === "open") {
    args.push("--share-net");
    for (const path of NETWORK_ETC) if (existsSync(path)) args.push("--ro-bind", path, path);
  }
  args.push(
    "--chdir",
    request.cwd ?? meta.cwd,
    "--clearenv",
    "--setenv",
    "PATH",
    meta.path.join(":"),
    "--setenv",
    "HOME",
    HOME,
  );
  for (const [key, value] of Object.entries({ ...meta.spec.env, ...request.env })) args.push("--setenv", key, value);
  args.push("--", ...request.argv);
  return args;
}

/** systemd-run's arguments for one capped exec, as transient user service `unit`. */
export function unitArgs(slice: string, unit: string, resources: Resources, timeoutSec: number | undefined): string[] {
  return [
    "--user",
    "--pipe",
    "--wait",
    "--quiet",
    "--collect",
    `--unit=${unit}`,
    `--slice=${slice}`,
    "-p",
    `MemoryMax=${resources.memoryMiB}M`,
    "-p",
    "MemorySwapMax=0",
    "-p",
    `CPUQuota=${Math.round(resources.cpus * 100)}%`,
    "-p",
    `TasksMax=${resources.pids}`,
    "-p",
    "Nice=19",
    // A backstop: the exec's own timer stops the unit first.
    ...(timeoutSec ? ["-p", `RuntimeMaxSec=${timeoutSec + 30}`] : []),
  ];
}

export function createBwrapProvider(options: BwrapOptions): SandboxProvider {
  const capabilities: Capabilities = {
    isolation: "namespaces",
    images: ["nix", "preset"],
    workspaces: ["empty", "git", "bind", "snapshot"],
    egress: ["none", "open"],
    enforces: options.slice ? ["cpus", "memoryMiB", "pids"] : [],
    ports: false,
    pause: false,
    snapshot: true,
    secrets: "none",
  };
  const sandboxes = join(options.root, "sandboxes");
  const dirOf = (id: string) => join(sandboxes, id);
  const metas = new Map<string, Meta>();
  /** Execs in one sandbox run one at a time. */
  const lanes = new Map<string, Promise<unknown>>();
  const images = new Map<string, string[]>();

  const meta = async (id: string): Promise<Meta> => {
    const known = metas.get(id);
    if (known) return known;
    try {
      const loaded = JSON.parse(await readFile(join(dirOf(id), "meta.json"), "utf8")) as Meta;
      metas.set(id, loaded);
      return loaded;
    } catch {
      throw new SandboxNotFound(id);
    }
  };

  /** The bin directories of a nixpkgs attribute, built (or found) by the host's nix. */
  const nixBins = async (attr: string): Promise<string[]> => {
    const cached = images.get(attr);
    if (cached) return cached;
    if (!options.nixpkgs) throw new SandboxUnsupported("bwrap", "nix images (the host policy names no nixpkgs)");
    const { stdout } = await run("nix", ["build", "--no-link", "--print-out-paths", "-f", options.nixpkgs, attr], {
      maxBuffer: 1024 * 1024,
      timeout: 15 * 60_000,
    });
    const bins = stdout
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => join(p, "bin"))
      .filter((p) => existsSync(p));
    images.set(attr, bins);
    return bins;
  };

  const imagePath = async (spec: SandboxSpec): Promise<string[]> => {
    if (!spec.image) return [SYSTEM_BIN];
    let attrs: string[];
    if ("preset" in spec.image) {
      const preset = options.images[spec.image.preset];
      if (!preset) throw new SandboxUnsupported("bwrap", `image preset ${spec.image.preset} (not in the host policy)`);
      attrs = preset;
    } else if ("nix" in spec.image) {
      attrs = spec.image.nix;
    } else {
      throw new SandboxUnsupported("bwrap", "oci images");
    }
    const bins = [];
    for (const attr of attrs) bins.push(...(await nixBins(attr)));
    return [...bins, SYSTEM_BIN];
  };

  const git = async (repo: string, args: string[]) => (await run("git", ["-C", repo, ...args], { maxBuffer: 16 * 1024 * 1024 })).stdout.trim();

  /**
   * The host path for an in-sandbox path under /workspace. The plugin reads and writes it with its
   * own rights, so it refuses `..` escapes, masked paths, and any symlink the sandbox planted on
   * the way: the real path must stay inside the workspace.
   */
  const hostPath = async (m: Meta, path: string, forWrite: boolean): Promise<string> => {
    const work = await realpath(m.work);
    const rel = relative(WORKSPACE, resolve(WORKSPACE, path));
    if (rel.startsWith("..")) throw new Error(`${path} is not under ${WORKSPACE}`);
    if (m.masks.some((mask) => rel === mask || rel.startsWith(`${mask}/`))) throw new Error(`${path} is read-only`);
    const target = join(work, rel);
    const inside = (p: string) => p === work || p.startsWith(`${work}/`);
    if (forWrite) {
      await mkdir(dirname(target), { recursive: true });
      if (!inside(await realpath(dirname(target)))) throw new Error(`${path} leaves ${WORKSPACE}`);
      if ((await lstat(target).catch(() => null))?.isSymbolicLink()) throw new Error(`${path} is a symlink`);
    } else if (!inside(await realpath(target))) {
      throw new Error(`${path} leaves ${WORKSPACE}`);
    }
    return target;
  };

  const userBus = () => {
    const uid = process.getuid?.() ?? 0;
    const runtime = `/run/user/${uid}`;
    return { runtime, bus: `${runtime}/bus` };
  };

  const execOnce = async (id: string, request: ExecRequest, signal?: AbortSignal): Promise<ExecResult> => {
    const m = await meta(id);
    const inner = [options.bwrap, ...bwrapArgs(dirOf(id), m, request)];
    let argv = ["nice", "-n", "19", ...inner];
    let env: NodeJS.ProcessEnv = process.env;
    let unit: string | null = null;
    if (options.slice) {
      const { runtime, bus } = userBus();
      if (!existsSync(bus)) {
        throw new Error(`cgroup caps are required but no user manager answers at ${bus} (is linger on for this account?)`);
      }
      unit = `bb-sandbox-${id}-${randomBytes(3).toString("hex")}`;
      argv = ["systemd-run", ...unitArgs(options.slice, unit, m.spec.resources, request.timeoutSec), "--", ...inner];
      env = { ...process.env, XDG_RUNTIME_DIR: runtime, DBUS_SESSION_BUS_ADDRESS: `unix:path=${bus}` };
    }
    const started = Date.now();
    const limitBytes = options.outputMaxBytes;
    return await new Promise<ExecResult>((done, fail) => {
      const child = spawn(argv[0], argv.slice(1), { stdio: ["pipe", "pipe", "pipe"], detached: true, env });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let outBytes = 0;
      let errBytes = 0;
      let timedOut = false;
      const kill = () => {
        // The unit runs under the user manager, not under this process: stop it there too.
        if (unit) execFile("systemctl", ["--user", "kill", "--signal=SIGKILL", unit], { env }, () => {});
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {
          // already gone
        }
      };
      const timer = request.timeoutSec ? setTimeout(() => ((timedOut = true), kill()), request.timeoutSec * 1000) : null;
      signal?.addEventListener("abort", kill, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        if (outBytes < limitBytes) out.push(chunk);
        outBytes += chunk.length;
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (errBytes < limitBytes) err.push(chunk);
        errBytes += chunk.length;
      });
      child.on("error", (error) => {
        if (timer) clearTimeout(timer);
        fail(error);
      });
      child.on("close", (code, sig) => {
        if (timer) clearTimeout(timer);
        // Whatever the command left behind in its group dies with it.
        kill();
        const clip = (parts: Buffer[], total: number) => {
          const text = Buffer.concat(parts).subarray(0, limitBytes).toString("utf8");
          return total > limitBytes ? `${text}\n[… ${total - limitBytes} more bytes]` : text;
        };
        done({
          exitCode: code ?? 128 + (sig ? constants.signals[sig] : 0),
          stdout: clip(out, outBytes),
          stderr: clip(err, errBytes),
          timedOut,
          durationMs: Date.now() - started,
        });
      });
      child.stdin.on("error", () => {});
      child.stdin.end(request.stdin ?? "");
    });
  };

  return {
    id: "bwrap",
    capabilities,

    async create(id, spec) {
      assertSupported(this, spec);
      const dir = dirOf(id);
      if (existsSync(dir)) throw new Error(`sandbox ${id} exists`);
      await mkdir(join(dir, "home"), { recursive: true });
      try {
        const m: Meta = { id, spec, work: join(dir, "work"), cwd: WORKSPACE, masks: [], mounts: [], path: [] };
        const ws = spec.workspace;
        if ("git" in ws) {
          const repo = await git(ws.git.repo, ["rev-parse", "--show-toplevel"]);
          const branch = ws.git.branch ?? `sandbox/${id}`;
          await git(repo, ["worktree", "add", "--quiet", "-b", branch, m.work, ws.git.ref]);
          m.git = { repo, branch };
          m.masks.push(".git");
          const hooks = await git(repo, ["config", "--get", "core.hooksPath"]).catch(() => "");
          if (hooks && !hooks.startsWith("/") && existsSync(join(m.work, hooks))) m.masks.push(hooks.replace(/\/+$/, ""));
          if (ws.git.subdir) m.cwd = join(WORKSPACE, ws.git.subdir);
        } else if ("bind" in ws) {
          assertBindable(ws.bind.path);
          m.work = await realpath(ws.bind.path);
          if (ws.bind.readOnly) m.mounts.push({ source: m.work, target: WORKSPACE, readOnly: true });
        } else if ("snapshot" in ws) {
          const tarball = join(options.root, "snapshots", `${ws.snapshot}.tar`);
          if (!existsSync(tarball)) throw new Error(`no snapshot ${ws.snapshot}`);
          await run("tar", ["-xf", tarball, "-C", dir, "--no-same-owner"]);
          await mkdir(m.work, { recursive: true });
        } else {
          await mkdir(m.work, { recursive: true });
        }
        for (const v of spec.storage.volumes) {
          const source = join(options.root, "volumes", v.name);
          await mkdir(source, { recursive: true });
          m.mounts.push({ source, target: v.mount, readOnly: v.readOnly });
        }
        for (const d of spec.storage.data) {
          assertBindable(d.source);
          if (!existsSync(d.source)) throw new Error(`data source ${d.source} does not exist`);
          m.mounts.push({ source: d.source, target: d.mount, readOnly: d.readOnly });
        }
        m.path = await imagePath(spec);
        await writeFile(join(dir, "meta.json"), JSON.stringify(m));
        metas.set(id, m);
      } catch (error) {
        await this.destroy(id).catch(() => {});
        throw error;
      }
    },

    exec(id, request, signal) {
      const previous = lanes.get(id) ?? Promise.resolve();
      const next = previous.catch(() => {}).then(() => execOnce(id, request, signal));
      lanes.set(id, next);
      return next;
    },

    async readFile(id, path) {
      return await readFile(await hostPath(await meta(id), path, false));
    },

    async writeFile(id, path, data) {
      const m = await meta(id);
      if (m.mounts.some((mount) => mount.target === WORKSPACE && mount.readOnly)) throw new Error("the workspace is read-only");
      await writeFile(await hostPath(m, path, true), data);
    },

    async listFiles(id, path) {
      const m = await meta(id);
      const base = await hostPath(m, path, false);
      const entries: FileEntry[] = [];
      for (const entry of await readdir(base, { withFileTypes: true })) {
        const stat = await lstat(join(base, entry.name));
        entries.push({
          path: join(resolve(WORKSPACE, path), entry.name),
          type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "dir" : "file",
          size: stat.size,
        });
        if (entries.length >= 2000) break;
      }
      return entries;
    },

    hostWorkspace(id) {
      return metas.get(id)?.work ?? null;
    },

    async snapshot(id) {
      const m = await meta(id);
      if (m.work !== join(dirOf(id), "work")) throw new SandboxUnsupported("bwrap", "snapshots of a bind workspace (its files are the host's)");
      const snapshotId = `snap-${randomBytes(6).toString("hex")}`;
      await mkdir(join(options.root, "snapshots"), { recursive: true });
      // The workspace and home; a git workspace's .git pointer is left out, since it names a
      // worktree that will not exist on restore.
      await run("tar", ["-cf", join(options.root, "snapshots", `${snapshotId}.tar`), "--exclude=./work/.git", "-C", dirOf(id), "./home", "./work"]);
      return { snapshotId };
    },

    async destroy(id) {
      const dir = dirOf(id);
      const m = await meta(id).catch(() => null);
      const outcome: Outcome = {};
      if (m?.git) {
        const { repo, branch } = m.git;
        const commit = await git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).catch(() => null);
        outcome.branch = { repo, name: branch, commit: commit || null };
        await git(repo, ["worktree", "remove", "--force", m.work]).catch(() => {});
        await git(repo, ["worktree", "prune"]).catch(() => {});
      }
      metas.delete(id);
      lanes.delete(id);
      await rm(dir, { recursive: true, force: true });
      return outcome;
    },

    async list() {
      if (!existsSync(sandboxes)) return [];
      const ids = [];
      for (const name of await readdir(sandboxes)) if (existsSync(join(sandboxes, name, "meta.json"))) ids.push(name);
      return ids;
    },
  };
}
