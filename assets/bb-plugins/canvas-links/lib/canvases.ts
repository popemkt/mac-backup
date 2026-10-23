// The panel's rules over plain data: the shape of `canvas-link ls --json`, parsing it at the boundary, search, the
// threads a row links to, and "edited 3h ago". The link rules themselves (merge, scopes, resolution) live in the
// canvas-link CLI (modules/stacks/ai-agents/canvas-links/cli); this file only reads its answer.

export type Scope = "session" | "project" | "all";
export const SCOPES: readonly Scope[] = ["session", "project", "all"];

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
  linkedAt: number;
  sessions: (Session & { ts: number })[];
  projects: Project[];
};

/** `canvas-link ls --json`. `central`: "ok", "unreachable", "off", or "skipped" (session scope reads local only). */
export type Listing = {
  scope: Scope;
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
    linkedAt: num(v.linkedAt) ?? 0,
    sessions: (Array.isArray(v.sessions) ? v.sessions : []).map(s => ({ ...session(s), ts: isObject(s) ? (num(s.ts) ?? 0) : 0 })),
    projects: (Array.isArray(v.projects) ? v.projects : []).map(project),
  };
}

/** The CLI's stdout, checked field by field: a newer or older CLI degrades a row, never the panel. */
export function parseListing(stdout: string): Listing {
  const raw: unknown = JSON.parse(stdout);
  if (!isObject(raw)) throw new Error("canvas-link ls --json did not print an object");
  const scope = SCOPES.find(s => s === raw.scope) ?? "session";
  return {
    scope,
    host: str(raw.host) ?? "",
    session: session(raw.session),
    project: project(raw.project),
    central: str(raw.central) ?? "off",
    canvases: (Array.isArray(raw.canvases) ? raw.canvases : []).map(canvas).filter((c): c is Canvas => c !== null),
  };
}

/** Every word of the query appears in the name, folder, host or a linking session. */
export function matches(c: Canvas, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(w => w !== "");
  if (words.length === 0) return true;
  const hay = [c.name, c.folder ?? "", c.host, ...c.sessions.map(s => `${s.harness} ${s.id ?? ""}`)].join(" ").toLowerCase();
  return words.every(w => hay.includes(w));
}

/** The bb threads that link a canvas, newest first, once each. */
export function threadIds(c: Canvas): string[] {
  const sorted = [...c.sessions].sort((a, b) => b.ts - a.ts);
  return [...new Set(sorted.filter(s => s.harness === "bb" && s.id !== null).map(s => s.id as string))];
}

/** Sessions from other harnesses, as "claude-code", "codex · 2", ... */
export function otherHarnesses(c: Canvas): string[] {
  const counts = new Map<string, number>();
  for (const s of c.sessions) if (s.harness !== "bb") counts.set(s.harness, (counts.get(s.harness) ?? 0) + 1);
  return [...counts].map(([h, n]) => (n > 1 ? `${h} · ${n}` : h));
}

/** "just now", "5m ago", "3h ago", "2d ago", "4w ago", then a date. */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 35) return `${Math.floor(d / 7)}w ago`;
  return new Date(at).toISOString().slice(0, 10);
}

/** The row's time line: when tldraw last saved it, else when it was linked. */
export function timeLabel(c: Canvas, now: number): string {
  return c.editedAt !== null ? `edited ${ago(c.editedAt, now)}` : `linked ${ago(c.linkedAt, now)}`;
}

/** `canvas-link open` answers "on <host>" with exit 3 for a canvas on another machine. */
export function elsewhereHost(exitCode: number, stdout: string): string | null {
  if (exitCode !== 3) return null;
  const m = /^on (\S+)/.exec(stdout.trim());
  return m === null ? null : m[1];
}
