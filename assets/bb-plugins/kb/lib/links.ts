// Linked items, the plugin's rules over plain data: which kb things bb threads touched. kb records a caller's
// `via` label on every write and reads its log back with `graph.changes` (kb DESIGN.md → Action registry → The
// caller's via); this file says what the plugin labels a thread's writes with, which changes link what, and how
// a listing is searched and dated. Threads, projects and machines are bb's, so they live here, never in kb.
// No bb and no network here, so tests run on plain data. The rows mirror the Canvases panel's
// (assets/bb-plugins/canvas-links/lib/canvases.ts) field for field where a field applies.

/** The kinds of kb thing a thread can be linked to. Canvases first; a kind is its tag and how a row names it. */
export const KINDS = { canvas: { tag: "sys.tag.canvas", route: (id: string) => `/canvas/${encodeURIComponent(id)}` } } as const;
export type Kind = keyof typeof KINDS;

export type Scope = "session" | "project" | "all";
export const SCOPES: readonly Scope[] = ["session", "project", "all"];

/** How a thread came to be linked: its agent wrote the item, or a person linked the one its kb tab showed. */
export type How = "wrote" | "linked";

const VIA_PREFIX = "bb:";

/** The `via` a thread's kb writes carry: kb_call states it, and the thread's kb CLI and MCP get it as KB_VIA. */
export const viaOfThread = (threadId: string): string => `${VIA_PREFIX}${threadId}`;

/** The thread a `via` names, when it is one of ours. */
export function threadOfVia(via: string | undefined): string | null {
  return via !== undefined && via.startsWith(VIA_PREFIX) && via.length > VIA_PREFIX.length ? via.slice(VIA_PREFIX.length) : null;
}

export type Change = {
  rev: number;
  at: number;
  via: string | null;
  wrote: { id: string; text: string; tags: string[] }[];
  deleted: string[];
};

/** `graph.changes` output, checked field by field: a newer or older kb degrades a change, never the log. */
export type ChangePage = { head: number; complete: boolean; changes: Change[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

function change(v: unknown): Change | null {
  if (!isObject(v) || typeof v.rev !== "number") return null;
  const at = Date.parse(str(v.at) ?? "");
  return {
    rev: v.rev,
    at: Number.isFinite(at) ? at : 0,
    via: str(v.via),
    wrote: (Array.isArray(v.wrote) ? v.wrote : []).flatMap(w => {
      const id = isObject(w) ? str(w.id) : null;
      return id === null || !isObject(w) ? [] : [{ id, text: str(w.text) ?? "", tags: strings(w.tags) }];
    }),
    deleted: strings(v.deleted),
  };
}

export function parseChangePage(output: unknown): ChangePage | null {
  if (!isObject(output) || typeof output.head !== "number") return null;
  return {
    head: output.head,
    complete: output.complete !== false,
    changes: (Array.isArray(output.changes) ? output.changes : []).map(change).filter((c): c is Change => c !== null),
  };
}

/** One item a change touched: what it is now, and the thread whose write it was, if a thread's. */
export type Touch = { kind: Kind; id: string; name: string; at: number; gone: boolean; thread: string | null };

/** What a page of changes did to linkable items, oldest first: every canvas written or deleted, by anyone. */
export function touches(changes: readonly Change[]): Touch[] {
  const out: Touch[] = [];
  for (const c of changes) {
    const thread = threadOfVia(c.via ?? undefined);
    for (const w of c.wrote) {
      const kind = (Object.keys(KINDS) as Kind[]).find(k => w.tags.includes(KINDS[k].tag));
      if (kind !== undefined) out.push({ kind, id: w.id, name: w.text, at: c.at, gone: false, thread });
    }
    // A deletion names only ids: it marks an item already known as gone, of whatever kind it was.
    for (const id of c.deleted) out.push({ kind: "canvas", id, name: "", at: c.at, gone: true, thread: null });
  }
  return out;
}

/** The canvas a kb tab shows, from `ui.screen`'s answer for that tab's session. */
export function openCanvasOf(screen: unknown): string | null {
  const tab = isObject(screen) && Array.isArray(screen.tabs) ? screen.tabs[0] : undefined;
  if (!isObject(tab) || !Array.isArray(tab.panes)) return null;
  const panes = tab.panes.filter(isObject);
  const active = panes.find(p => p.id === tab.activePane) ?? panes[0];
  if (active === undefined) return null;
  const view = isObject(active.view) ? active.view : null;
  if (view !== null && view.key === "canvas" && typeof view.subject === "string") return view.subject;
  const m = /^\/canvas\/([^/?#]+)/.exec(str(active.route) ?? "");
  return m === null ? null : decodeURIComponent(m[1]);
}

export type ThreadLink = { id: string; how: How; at: number; host: string | null };

/** One row of the panel: a linked item, and every thread that links it. */
export type LinkedItem = {
  key: string;
  kind: Kind;
  id: string;
  name: string;
  /** Which kb it lives in, as the panel names it. */
  store: string;
  /** When anyone last wrote it, as far as the plugin has seen. */
  editedAt: number | null;
  /** When a thread in this scope last linked it. */
  linkedAt: number;
  gone: boolean;
  /** Shown in this thread's kb tab now. */
  open: boolean;
  threads: ThreadLink[];
};

/** Every word of the query appears in the name, the store or a linking thread's title or id. */
export function matches(item: LinkedItem, query: string, titles: Readonly<Record<string, string | null>> = {}): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(w => w !== "");
  if (words.length === 0) return true;
  const hay = [item.name, item.store, ...item.threads.flatMap(t => [t.id, titles[t.id] ?? ""])].join(" ").toLowerCase();
  return words.every(w => hay.includes(w));
}

/** The threads that link an item, newest first, once each. */
export function threadIds(item: LinkedItem): string[] {
  return [...new Set([...item.threads].sort((a, b) => b.at - a.at).map(t => t.id))];
}

// GAP [[01M5QJFW217ZNBXHEX74VG7VYP]]: `ago` and the row anatomy are copied from the Canvases panel
// (canvas-links/lib/canvases.ts, app.tsx) while the owner compares the two; one shared linked-items row once
// the UX settles.
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

/** The row's time line: when it was last written, else when it was linked. */
export function timeLabel(item: LinkedItem, now: number): string {
  return item.editedAt !== null ? `edited ${ago(item.editedAt, now)}` : `linked ${ago(item.linkedAt, now)}`;
}
