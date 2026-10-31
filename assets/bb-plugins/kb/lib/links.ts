// Linked items, the plugin's rules over plain data: which kb things bb threads touched. kb records a caller's
// `via` label on every write and reads its log back with `graph.changes` (kb DESIGN.md → Action registry → The
// caller's via); this file says what the plugin labels a thread's writes with, which changes link what, and how
// a listing is searched and dated. Threads, projects and machines are bb's, so they live here, never in kb.
// No bb and no network here, so tests run on plain data. A row is drawn as the Canvases panel draws its own
// (assets/bb-plugins/linked-items).
import type { LinkRow, Scope } from "../../linked-items/rows.ts";

// GAP [[01M5QJFW217ZNBXHEX74VG7VYP]]: bb's server build rejects a runtime import from outside the plugin folder
// ("server source import escapes the plugin directory"), so server code imports ../linked-items for types only
// (erased before bundling) and keeps its own copy of the scope list. The client build bundles it fine.
export const SCOPES = ["session", "project", "all"] as const satisfies readonly Scope[];

/** The kinds of kb thing a thread can be linked to. Canvases first; a kind is its tag and how a row names it. */
export const KINDS = { canvas: { tag: "sys.tag.canvas", route: (id: string) => `/canvas/${encodeURIComponent(id)}` } } as const;
export type Kind = keyof typeof KINDS;

/** How a thread came to be linked: its agent wrote the item, or a person linked the one its kb tab showed. */
export type How = "wrote" | "linked";

/** Every thread's label starts so; `graph.changes` reads only these writes (kb matches it on a separator). */
export const VIA_PREFIX = "bb:";

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

/**
 * `graph.changes` output, checked field by field: a newer or older kb degrades a change, never the log. `through`
 * is the last rev kb read, matched or not: the next page starts after it.
 */
export type ChangePage = { head: number; through: number; complete: boolean; changes: Change[] };

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
  const changes = (Array.isArray(output.changes) ? output.changes : []).map(change).filter((c): c is Change => c !== null);
  return {
    head: output.head,
    through: typeof output.through === "number" ? output.through : (changes.at(-1)?.rev ?? output.head),
    complete: output.complete !== false,
    changes,
  };
}

/** One item a change touched: what it is now, and the thread whose write it was, if a thread's. */
export type Touch = { kind: Kind; id: string; name: string; at: number; gone: boolean; thread: string | null };

/** What a page of changes did to linkable items, oldest first: every canvas written or deleted. */
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
  /** When a thread in this scope last linked it; null for a canvas nobody linked. */
  linkedAt: number | null;
  gone: boolean;
  /** Shown in this thread's kb tab now. */
  open: boolean;
  threads: ThreadLink[];
};

/** How a row draws an item: shared with the Canvases panel (assets/bb-plugins/linked-items/rows.ts). A link a
 * thread's writes made is only claimed: `via` is the caller's own label, which kb records but does not check. */
export function rowOf(item: LinkedItem, threadId: string): LinkRow {
  const mine = item.threads.filter(t => t.id === threadId);
  const notes = mine.some(t => t.how === "linked") ? ["linked by hand"] : mine.length > 0 ? ["claimed by this thread"] : [];
  return {
    key: item.key,
    name: item.name,
    title: item.id,
    where: `kb · ${item.store}`,
    notes,
    gone: item.gone ? "deleted" : null,
    open: item.open ? "open in the kb tab" : null,
    editedAt: item.editedAt,
    linkedAt: item.linkedAt,
    threads: item.threads.map(t => ({ id: t.id, at: t.at, claimed: t.how === "wrote" })),
    tags: [],
    search: [item.store],
  };
}
