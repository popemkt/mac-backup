// The panel's rules over plain data: the shape of `canvas-link ls --json`, parsing it at the boundary, search, the
// threads a row links to, and "edited 3h ago". The link rules themselves (merge, scopes, resolution) live in the
// canvas-link CLI (modules/stacks/ai-agents/canvas-links/cli); this file only reads its answer. Rows are drawn,
// searched and dated as the kb canvases panel's are (assets/bb-plugins/linked-items).
import type { LinkRow, Scope } from "../../linked-items/rows.ts";

export type { Scope };
// GAP [[01M5QJFW217ZNBXHEX74VG7VYP]]: bb's server build rejects a runtime import from outside the plugin folder
// ("server source import escapes the plugin directory"), so server code imports ../linked-items for types only
// (erased before bundling) and keeps its own copy of the scope list. The client build bundles it fine.
export const SCOPES = ["session", "project", "all"] as const satisfies readonly Scope[];

export type Session = { harness: string; id: string | null };
export type Project = { remote: string | null; root: string | null };

export type Canvas = {
  key: string;
  documentId: string | null;
  path: string | null;
  host: string;
  name: string;
  folder: string | null;
  local: boolean;
  exists: boolean | null;
  open: boolean;
  /** When tldraw last saved a change, if this machine's tldraw knows the canvas. */
  editedAt: number | null;
  /** Null for a canvas nobody linked (`ls --available`). */
  linkedAt: number | null;
  sessions: (Session & { ts: number })[];
  projects: Project[];
};

/**
 * `canvas-link ls --json`. `central`: "ok", "unreachable", "off", or "skipped" (session scope reads local only).
 * `available`: every linked canvas plus the ones tldraw on that machine knows.
 */
export type Listing = {
  scope: Scope | "available";
  host: string;
  session: Session;
  project: Project;
  central: string;
  canvases: Canvas[];
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function session(v: unknown): Session {
  return isObject(v) ? { harness: str(v.harness) ?? "unknown", id: str(v.id) } : { harness: "unknown", id: null };
}

function project(v: unknown): Project {
  return isObject(v) ? { remote: str(v.remote), root: str(v.root) } : { remote: null, root: null };
}

function canvas(v: unknown): Canvas | null {
  if (!isObject(v)) return null;
  const key = str(v.key);
  const host = str(v.host);
  if (key === null || host === null) return null;
  return {
    key,
    documentId: str(v.documentId),
    path: str(v.path),
    host,
    name: str(v.name) ?? key,
    folder: str(v.folder),
    local: v.local === true,
    exists: typeof v.exists === "boolean" ? v.exists : null,
    open: v.open === true,
    editedAt: num(v.editedAt),
    linkedAt: num(v.linkedAt),
    sessions: (Array.isArray(v.sessions) ? v.sessions : []).map(s => ({ ...session(s), ts: isObject(s) ? (num(s.ts) ?? 0) : 0 })),
    projects: (Array.isArray(v.projects) ? v.projects : []).map(project),
  };
}

/** The CLI's stdout, checked field by field: a newer or older CLI degrades a row, never the panel. */
export function parseListing(stdout: string): Listing {
  const raw: unknown = JSON.parse(stdout);
  if (!isObject(raw)) throw new Error("canvas-link ls --json did not print an object");
  const scope = raw.scope === "available" ? "available" : (SCOPES.find(s => s === raw.scope) ?? "session");
  return {
    scope,
    host: str(raw.host) ?? "",
    session: session(raw.session),
    project: project(raw.project),
    central: str(raw.central) ?? "off",
    canvases: (Array.isArray(raw.canvases) ? raw.canvases : []).map(canvas).filter((c): c is Canvas => c !== null),
  };
}

/** Sessions from other harnesses, as "claude-code", "codex · 2", ... */
export function otherHarnesses(c: Canvas): string[] {
  const counts = new Map<string, number>();
  for (const s of c.sessions) if (s.harness !== "bb") counts.set(s.harness, (counts.get(s.harness) ?? 0) + 1);
  return [...counts].map(([h, n]) => (n > 1 ? `${h} · ${n}` : h));
}

/** How a row draws a canvas. canvas-link records the session that ran it; bb threads are chips, other harnesses tags. */
export function rowOf(c: Canvas): LinkRow {
  const missing = c.local && c.exists === false;
  return {
    key: c.key,
    name: c.name,
    title: c.path ?? c.key,
    where: c.local ? (c.folder ?? "") : `on ${c.host}`,
    notes: [],
    gone: missing ? "file gone" : null,
    open: c.open ? "open now" : null,
    editedAt: c.editedAt,
    linkedAt: c.linkedAt,
    threads: c.sessions.flatMap(s => (s.harness === "bb" && s.id !== null ? [{ id: s.id, at: s.ts, claimed: false }] : [])),
    tags: otherHarnesses(c),
    search: [c.folder ?? "", c.host, ...c.sessions.map(s => `${s.harness} ${s.id ?? ""}`)],
  };
}

/** The machine a key names: canvas-link keys a canvas `<host>:<documentId|path>`. */
export function hostOfKey(key: string): string | null {
  const m = /^([a-z0-9][a-z0-9._-]*):./.exec(key);
  return m === null ? null : m[1];
}

/** `canvas-link open` answers "on <host>" with exit 3 for a canvas on another machine. */
export function elsewhereHost(exitCode: number, stdout: string): string | null {
  if (exitCode !== 3) return null;
  const m = /^on (\S+)/.exec(stdout.trim());
  return m === null ? null : m[1];
}
