#!/usr/bin/env node
// canvas-link: which tldraw offline canvases each agent session (bb thread,
// Claude Code, Codex, Orca, ...) created or edited. Appends one JSON line per
// op to a local log, pushes unsent lines to a central host in the background,
// and lists or opens what a session, a project or everyone linked. The rules
// live in lib.mjs; this file is the I/O around them.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  currentPath,
  findCanvas,
  listCanvases,
  mergeRows,
  normalizeRemote,
  parseRows,
  recentFiles,
  resolveCanvas,
  sessionFromEnv,
  ulid,
} from "./lib.mjs";

const HELP = `Usage: canvas-link <command>

  add <path|docId>     record that this session created or edited a canvas
  rm <path|docId>      drop this session's link to a canvas
  ls [--session|--project|--all] [--json]
                       canvases this session (default), this project (same git
                       remote) or anyone linked; --project/--all include the
                       central log when it is reachable
  open <key>           open a canvas on this machine in tldraw offline; a
                       canvas on another machine prints "on <host>", exit 3
  flush                push unsent rows to the central log

Session comes from BB_THREAD_ID, ORCA_AGENT_SESSION_ID / ORCA_PANE_KEY,
CLAUDE_CODE_SESSION_ID, or CODEX_THREAD_ID / CODEX_SESSION_ID, in that order.
Log: \${XDG_STATE_HOME:-~/.local/state}/canvas-links/links.jsonl.
Central log: ssh destination in CANVAS_LINK_CENTRAL (unset: local only).`;

const HOME = homedir();
const STATE = join(process.env.XDG_STATE_HOME || join(HOME, ".local/state"), "canvas-links");
const LOG = join(STATE, "links.jsonl");
const CURSOR = join(STATE, "pushed");
const LOCK = join(STATE, "flush.lock");
const TLDRAW = join(HOME, "Library/Application Support/tldraw");
const HOST = hostname().split(".")[0].toLowerCase();
const CENTRAL = process.env.CANVAS_LINK_CENTRAL || null;
// Each machine appends to its own file there, so two machines never interleave a line.
const REMOTE_DIR = ".local/state/canvas-links/hosts";
// A background push cannot answer a host-key prompt: the first key seen is
// kept in canvas-link's own known_hosts (the tailnet already authenticates the
// peer), and ~/.ssh is left alone.
const SSH = [
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=5",
  "-o", "StrictHostKeyChecking=accept-new",
  "-o", `UserKnownHostsFile=${join(STATE, "known_hosts")}`,
];

class UsageError extends Error {}

const readJson = path => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const localRows = () => (existsSync(LOG) ? parseRows(readFileSync(LOG, "utf8")) : []);
const recent = () => recentFiles(readJson(join(TLDRAW, "recent-files.json")));

/** The docs the running tldraw app has open, or [] when it is not running. */
async function openDocs() {
  const server = readJson(join(TLDRAW, "server.json"));
  if (server === null || typeof server.port !== "number") return [];
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${server.token}` },
      body: JSON.stringify({ code: "return await api.getDocs()" }),
      signal: AbortSignal.timeout(1500),
    });
    const body = await res.json();
    if (body?.success !== true || !Array.isArray(body.result)) return [];
    return body.result
      .filter(d => typeof d?.filePath === "string")
      .map(d => ({ id: d.id, documentId: d.documentId ?? null, path: d.filePath }));
  } catch {
    return [];
  }
}

function git(cwd, ...args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function projectOf(cwd) {
  const root = git(cwd, "rev-parse", "--show-toplevel");
  return { remote: normalizeRemote(git(cwd, "remote", "get-url", "origin")), root: root ?? cwd };
}

/** One row, one write: O_APPEND keeps concurrent writers from splitting a line. */
function append(row) {
  mkdirSync(STATE, { recursive: true });
  const fd = openSync(LOG, "a");
  try {
    writeSync(fd, `${JSON.stringify(row)}\n`);
  } finally {
    closeSync(fd);
  }
}

/** Starts `flush` detached: the caller never waits on the network. */
function flushInBackground() {
  if (CENTRAL === null) return;
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "flush", "--quiet"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function record(op, args) {
  const [arg, ...rest] = args;
  if (arg === undefined || rest.length > 0) throw new UsageError(`${op === "link" ? "add" : "rm"} takes one <path|docId>`);
  const isPath = arg.includes("/") || /\.tldr(aw)?$/i.test(arg);
  const path = isPath ? resolve(arg) : arg;
  if (isPath && !/\.tldr(aw)?$/i.test(path)) throw new UsageError(`not a tldraw file: ${path}`);
  const files = recent();
  let canvas = resolveCanvas(path, { isPath, recent: files });
  if (canvas === null || canvas.documentId === null) canvas = resolveCanvas(path, { isPath, recent: files, docs: await openDocs() });
  if (canvas === null) throw new Error(`no canvas with document id ${arg} in tldraw's recent files or open windows`);
  const session = sessionFromEnv(process.env);
  if (session.id === null) console.error("canvas-link: no agent session in the environment; recorded without one");
  const now = Date.now();
  const row = {
    id: ulid(now, randomBytes(16)),
    ts: now,
    op,
    kind: "tldraw",
    canvas: { documentId: canvas.documentId, path: canvas.path, host: HOST },
    session,
    project: projectOf(process.cwd()),
    source: "canvas-link",
  };
  append(row);
  flushInBackground();
  console.log(`${op === "link" ? "linked" : "unlinked"} ${canvas.path ?? canvas.documentId} (${session.harness}:${session.id ?? "-"})`);
}

/** Pushes what was appended since the last push. Idempotent: the central log merges by row id. */
function flush(quiet) {
  if (CENTRAL === null) {
    if (!quiet) console.log("no central log (CANVAS_LINK_CENTRAL is unset)");
    return 0;
  }
  if (!existsSync(LOG)) return 0;
  mkdirSync(STATE, { recursive: true });
  let lock;
  try {
    lock = openSync(LOCK, "wx");
  } catch {
    // A flush that died keeps its lock; after two minutes it is stale.
    if (Date.now() - statSync(LOCK).mtimeMs < 120_000) {
      if (!quiet) console.log("another flush is running");
      return 0;
    }
    unlinkSync(LOCK);
    lock = openSync(LOCK, "wx");
  }
  try {
    const size = statSync(LOG).size;
    let from = existsSync(CURSOR) ? Number.parseInt(readFileSync(CURSOR, "utf8"), 10) : 0;
    if (!Number.isFinite(from) || from > size) from = 0;
    const buf = Buffer.alloc(size - from);
    const fd = openSync(LOG, "r");
    try {
      readSync(fd, buf, 0, buf.length, from);
    } finally {
      closeSync(fd);
    }
    // Only whole lines: a row being written now goes with the next push.
    const end = buf.lastIndexOf(0x0a) + 1;
    if (end === 0) {
      if (!quiet) console.log("nothing to push");
      return 0;
    }
    const target = `${REMOTE_DIR}/${HOST.replace(/[^a-z0-9._-]/g, "_")}.jsonl`;
    const r = spawnSync("ssh", [...SSH, CENTRAL, `mkdir -p ${REMOTE_DIR} && cat >> ${target}`], {
      input: buf.subarray(0, end),
      encoding: "utf8",
      timeout: 20_000,
    });
    if (r.status !== 0) {
      if (!quiet) console.error(`push to ${CENTRAL} failed: ${(r.stderr || r.error?.message || "").trim()}`);
      return 1;
    }
    writeFileSync(CURSOR, String(from + end));
    if (!quiet) console.log(`pushed ${buf.subarray(0, end).toString("utf8").split("\n").length - 1} row(s) to ${CENTRAL}`);
    return 0;
  } finally {
    closeSync(lock);
    unlinkSync(LOCK);
  }
}

/** Every machine's rows from the central log, or null when it cannot be read. */
function centralRows() {
  if (CENTRAL === null) return null;
  mkdirSync(STATE, { recursive: true });
  const r = spawnSync("ssh", [...SSH, CENTRAL, `cat ${REMOTE_DIR}/*.jsonl 2>/dev/null; true`], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return r.status === 0 ? parseRows(r.stdout) : null;
}

const tilde = p => (p.startsWith(`${HOME}/`) ? `~${p.slice(HOME.length)}` : p);

async function ls(args) {
  const flags = new Set(args);
  const unknown = args.filter(a => !["--session", "--project", "--all", "--json"].includes(a));
  if (unknown.length > 0) throw new UsageError(`unexpected ${unknown.join(" ")}`);
  const session = sessionFromEnv(process.env);
  const scope = flags.has("--all") ? "all" : flags.has("--project") ? "project" : flags.has("--session") || session.id !== null ? "session" : "project";
  const project = projectOf(process.cwd());
  let central = CENTRAL === null ? "off" : "skipped";
  let rows = localRows();
  if (scope !== "session" && CENTRAL !== null) {
    const remote = centralRows();
    central = remote === null ? "unreachable" : "ok";
    if (remote !== null) rows = mergeRows(rows, remote);
  }
  const files = recent();
  const docs = await openDocs();
  const canvases = listCanvases(rows, { scope, session, project }).map(c => {
    const local = c.host === HOST;
    const path = local ? currentPath(c, files) : c.path;
    const file = local ? files.find(f => (c.documentId !== null && f.documentId === c.documentId) || f.path === path) : undefined;
    const open = local && docs.some(d => (c.documentId !== null && d.documentId === c.documentId) || d.path === path);
    return {
      ...c,
      path,
      name: path === null ? (c.documentId ?? c.key) : basename(path, extname(path)),
      folder: path === null ? null : tilde(dirname(path)),
      local,
      exists: local && path !== null ? existsSync(path) : null,
      open,
      editedAt: file?.lastChangedAt ?? null,
    };
  });
  if (flags.has("--json")) {
    console.log(JSON.stringify({ scope, host: HOST, session, project, central, canvases }));
    return;
  }
  if (central === "unreachable") console.error(`central log on ${CENTRAL} unreachable; local links only`);
  if (canvases.length === 0) {
    console.log(`no canvases linked (${scope})`);
    return;
  }
  for (const c of canvases) {
    const where = c.local ? (c.folder ?? "") : `on ${c.host}`;
    const by = [...new Set(c.sessions.map(s => `${s.harness}:${s.id ?? "-"}`))].join(", ");
    console.log(`${c.open ? "●" : " "} ${c.name}  ${where}  [${by}]  ${c.key}`);
  }
}

function open(args) {
  const [key, ...rest] = args;
  if (key === undefined || rest.length > 0) throw new UsageError("open takes one <key>");
  let canvas = findCanvas(listCanvases(localRows(), { scope: "all" }), key);
  if (canvas === null) {
    // A key from another machine's listing, or a bare path or document id.
    const m = /^([a-z0-9._-]+):(.+)$/i.exec(key);
    const host = m !== null && m[1] !== "tldr" ? m[1].toLowerCase() : HOST;
    const ident = m !== null && m[1] !== "tldr" ? m[2] : key;
    canvas = ident.startsWith("/") ? { host, documentId: null, path: ident } : { host, documentId: ident, path: null };
  }
  // GAP [[01M5M0X6NAE1AMVDKCSG41E0NP]] a canvas on another machine is only named, not opened.
  if (canvas.host !== HOST) {
    console.log(`on ${canvas.host}`);
    return 3;
  }
  const path = currentPath(canvas, recent()) ?? resolveCanvas(key, { isPath: false, recent: recent() })?.path ?? null;
  if (path === null || !existsSync(path)) throw new Error(`canvas not found on this machine: ${path ?? key}`);
  if (process.platform !== "darwin") throw new Error("opening needs tldraw offline on macOS");
  // `open -a` avoids the confirmation dialog the tldraw-offline:// URL shows.
  const r = spawnSync("open", ["-a", "tldraw offline", path], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`open failed: ${(r.stderr || r.error?.message || "").trim()}`);
  console.log(`opened ${path}`);
  return 0;
}

async function main(argv) {
  const [command, ...args] = argv;
  switch (command) {
    case "add":
      await record("link", args);
      return 0;
    case "rm":
      await record("unlink", args);
      return 0;
    case "ls":
      await ls(args);
      return 0;
    case "open":
      return open(args);
    case "flush":
      return flush(args.includes("--quiet"));
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return command === undefined ? 2 : 0;
    default:
      throw new UsageError(`unknown command ${command}`);
  }
}

main(process.argv.slice(2)).then(
  code => process.exit(code),
  err => {
    console.error(`canvas-link: ${err.message}`);
    if (err instanceof UsageError) console.error(`\n${HELP}`);
    process.exit(err instanceof UsageError ? 2 : 1);
  },
);
