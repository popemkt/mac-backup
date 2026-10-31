// canvas-link's rules over plain data: rows, the session and project a row is
// recorded for, parsing and merging logs, the current link set, and resolving a
// canvas through tldraw's recent-files.json. No I/O here; canvas-link.mjs does
// that. Tested by tests/lib.test.mjs.

/** @typedef {{ harness: string, id: string | null }} Session */
/** @typedef {{ remote: string | null, root: string | null }} Project */
/** @typedef {{ documentId: string | null, path: string | null, host: string }} Canvas */
/**
 * @typedef {{
 *   id: string, ts: number, op: "link" | "unlink", kind: "tldraw",
 *   canvas: Canvas, session: Session, project: Project, source: string
 * }} Row
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A ULID: 10 time characters then 16 random ones, so ids sort by creation time. */
export function ulid(now, randomBytes) {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD[randomBytes[i] % 32];
  return time + rand;
}

/**
 * The agent session a command runs in, from its environment. bb first: a bb
 * thread runs a provider CLI that sets its own variables too, and the thread is
 * what a person navigates to. Orca wraps provider CLIs the same way.
 */
export function sessionFromEnv(env) {
  const pick = (harness, ...names) => {
    for (const name of names) {
      const value = env[name];
      if (typeof value === "string" && value !== "") return { harness, id: value };
    }
    return null;
  };
  return (
    pick("bb", "BB_THREAD_ID") ??
    pick("orca", "ORCA_AGENT_SESSION_ID", "ORCA_PANE_KEY") ??
    pick("claude-code", "CLAUDE_CODE_SESSION_ID") ??
    pick("codex", "CODEX_THREAD_ID", "CODEX_SESSION_ID") ?? { harness: "shell", id: null }
  );
}

/** `git@github.com:a/b.git`, `https://user@github.com/a/b` and `ssh://git@github.com/a/b.git` all become `github.com/a/b`. */
export function normalizeRemote(url) {
  if (typeof url !== "string") return null;
  let s = url.trim();
  if (s === "") return null;
  const scp = /^[^@/]+@([^:/]+):(.+)$/.exec(s);
  if (scp !== null) s = `${scp[1]}/${scp[2]}`;
  else s = s.replace(/^[a-z+]+:\/\//i, "").replace(/^[^@/]+@/, "");
  s = s.replace(/:\d+\//, "/").replace(/\/+$/, "").replace(/\.git$/, "");
  return s.toLowerCase();
}

/** Whether a row belongs to a project: the same remote, or the same root when neither has one. */
export function sameProject(a, b) {
  if (a.remote !== null || b.remote !== null) return a.remote === b.remote;
  return a.root !== null && a.root === b.root;
}

export const sameSession = (a, b) => a.id !== null && a.harness === b.harness && a.id === b.id;

/** Rows from a JSONL text. A line that is not a whole row (a torn last line, a stray edit) is skipped. */
export function parseRows(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const row = JSON.parse(line);
      if (isRow(row)) rows.push(row);
    } catch {
      // torn or foreign line
    }
  }
  return rows;
}

function isRow(v) {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.id === "string" &&
    typeof v.ts === "number" &&
    (v.op === "link" || v.op === "unlink") &&
    typeof v.canvas === "object" &&
    v.canvas !== null &&
    typeof v.canvas.host === "string" &&
    typeof v.session === "object" &&
    v.session !== null &&
    typeof v.project === "object" &&
    v.project !== null
  );
}

/** Set-union by id, in (ts, host, id) order: the same rows in any order, or pushed twice, merge to one log. */
export function mergeRows(...logs) {
  const byId = new Map();
  for (const log of logs) for (const row of log) if (!byId.has(row.id)) byId.set(row.id, row);
  return [...byId.values()].sort(
    (a, b) => a.ts - b.ts || cmp(a.canvas.host, b.canvas.host) || cmp(a.id, b.id),
  );
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** One canvas across renames: its document id on its host, else its path there. */
export function canvasKey(canvas) {
  return `${canvas.host}:${canvas.documentId ?? canvas.path}`;
}

const sessionKey = s => `${s.harness}:${s.id}`;

/** The rows still in force: the last op per (canvas, session) wins, and only links remain. */
export function currentLinks(rows) {
  const last = new Map();
  for (const row of mergeRows(rows)) last.set(`${canvasKey(row.canvas)}\u0000${sessionKey(row.session)}`, row);
  return [...last.values()].filter(r => r.op === "link");
}

/**
 * The canvases a scope shows, newest link first, each with every session and
 * project that links it. `scope` is "session", "project" or "all".
 */
export function listCanvases(rows, { scope, session, project }) {
  const links = currentLinks(rows).filter(r =>
    scope === "session" ? sameSession(r.session, session) : scope === "project" ? sameProject(r.project, project) : true,
  );
  const byCanvas = new Map();
  for (const r of links) {
    const key = canvasKey(r.canvas);
    let entry = byCanvas.get(key);
    if (entry === undefined) {
      entry = { key, documentId: r.canvas.documentId, path: r.canvas.path, host: r.canvas.host, linkedAt: 0, sessions: [], projects: [] };
      byCanvas.set(key, entry);
    }
    // The newest row knows the latest path.
    if (r.ts >= entry.linkedAt) {
      entry.linkedAt = r.ts;
      if (r.canvas.path !== null) entry.path = r.canvas.path;
    }
    entry.sessions.push({ harness: r.session.harness, id: r.session.id, ts: r.ts });
    if (!entry.projects.some(p => p.remote === r.project.remote && p.root === r.project.root)) entry.projects.push(r.project);
  }
  return [...byCanvas.values()].sort((a, b) => b.linkedAt - a.linkedAt);
}

/** The entries of tldraw's recent-files.json, as { documentId, path, lastChangedAt }. */
export function recentFiles(json) {
  const files = json !== null && typeof json === "object" && typeof json.files === "object" && json.files !== null ? json.files : {};
  return Object.values(files)
    .filter(f => f !== null && typeof f === "object" && typeof f.filePath === "string")
    .map(f => ({
      documentId: typeof f.documentId === "string" ? f.documentId : null,
      workingCopyKey: typeof f.workingCopyKey === "string" ? f.workingCopyKey : null,
      path: f.filePath,
      lastChangedAt: typeof f.lastChangedAt === "number" ? f.lastChangedAt : null,
    }));
}

/**
 * A canvas named by a path or a document id, against the recent files and the
 * docs the running app reports (each { documentId, path }, optionally `id`).
 * A path is kept even when tldraw has never seen it; an id must resolve.
 */
export function resolveCanvas(arg, { isPath, recent, docs = [] }) {
  const known = [...docs, ...recent];
  if (isPath) {
    const hit = known.find(f => f.path === arg && f.documentId !== null);
    return { documentId: hit?.documentId ?? null, path: arg };
  }
  const hit = known.find(f => f.documentId === arg || f.workingCopyKey === arg || f.id === arg);
  return hit === undefined ? null : { documentId: hit.documentId, path: hit.path };
}

/** Where a canvas lives now: tldraw follows a document through renames and moves, the log does not. */
export function currentPath(canvas, recent) {
  if (canvas.documentId !== null) {
    const hit = recent.find(f => f.documentId === canvas.documentId);
    if (hit !== undefined) return hit.path;
  }
  return canvas.path;
}

/** The canvas an `open` key names: a listed key, a document id, or a path. */
export function findCanvas(canvases, key) {
  return (
    canvases.find(c => c.key === key) ??
    canvases.find(c => c.documentId !== null && c.documentId === key) ??
    canvases.find(c => c.path === key) ??
    null
  );
}

/**
 * A key as `ls` prints it, `<host>:<documentId|path>`, split; null when `arg`
 * is not one. tldraw's own working-copy keys (`tldr:file:…`) are not keys.
 */
export function parseKey(arg) {
  const m = /^([a-z0-9][a-z0-9._-]*):(.+)$/i.exec(arg);
  if (m === null || m[1].toLowerCase() === "tldr") return null;
  const host = m[1].toLowerCase();
  const ident = m[2];
  return ident.startsWith("/") ? { host, documentId: null, path: ident } : { host, documentId: ident, path: null };
}

/**
 * The canvas a key names, as the log should record it: a listed canvas keeps
 * its document id and latest path; one on `host` that tldraw knows gets them
 * from its recent files; any other key is taken as it reads. Null when `key`
 * is not a key.
 */
export function canvasForKey(key, { canvases, recent, host }) {
  const parsed = parseKey(key);
  if (parsed === null) return null;
  const listed = canvases.find(c => c.key === key);
  if (listed !== undefined) return { documentId: listed.documentId, path: listed.path, host: listed.host };
  if (parsed.host === host) {
    const hit = recent.find(f => (parsed.documentId !== null && f.documentId === parsed.documentId) || (parsed.path !== null && f.path === parsed.path));
    if (hit !== undefined) return { documentId: parsed.documentId ?? hit.documentId, path: hit.path, host };
  }
  return parsed;
}

/**
 * Every canvas one could link from `host`: each linked canvas (as `listCanvases`
 * gives them for "all"), then the ones tldraw there knows that nobody linked,
 * most recently changed first, with no sessions.
 */
export function availableCanvases(linked, recent, host) {
  const known = c => linked.some(l => l.host === host && ((c.documentId !== null && l.documentId === c.documentId) || l.path === c.path));
  const unlinked = recent
    .filter(f => !known(f))
    .sort((a, b) => (b.lastChangedAt ?? 0) - (a.lastChangedAt ?? 0))
    .map(f => {
      const canvas = { documentId: f.documentId, path: f.path, host };
      return { key: canvasKey(canvas), ...canvas, linkedAt: null, sessions: [], projects: [] };
    });
  return [...linked, ...unlinked];
}
