// Linked items, shared by the panels that list what bb threads linked: the Canvases panel (canvas-links, tldraw
// canvases) and the kb canvases panel (kb). Each plugin maps its own items to a LinkRow; the scopes, search,
// selection, the actions on a selection, dating and thread chips are stated once here, row.tsx draws a row and
// panel.tsx the whole panel the same way for both. Imported by relative path: bb's build bundles it into each
// plugin, and bb-plugins-sync reinstalls them when it changes (modules/common/home-manager/bb-plugins/). No
// imports, so any plugin's tests can load it.

export type Scope = "session" | "project" | "all";
export const SCOPES: readonly Scope[] = ["session", "project", "all"];
export const SCOPE_LABELS: Record<Scope, string> = { session: "Thread", project: "Project", all: "All" };

/** A thread that links the item: since when, and whether only on its own say-so (a write's label). */
export type RowThread = { id: string; at: number; claimed: boolean };

/** One row, as both panels draw it. */
export type LinkRow = {
  key: string;
  name: string;
  /** The row's tooltip: the item's full path or id. */
  title: string;
  /** The second line: where the item lives. */
  where: string;
  /** Short facts after it ("linked by hand"). */
  notes: string[];
  /** Why the item cannot be opened any more ("file gone", "deleted"), shown struck through. */
  gone: string | null;
  /** Shown now, and where ("open now", "open in the kb tab"); null when not. */
  open: string | null;
  editedAt: number | null;
  /** When a thread in the listing's scope last linked it; null for an item nobody linked. */
  linkedAt: number | null;
  /** The bb threads that link it; chips in Project and All. */
  threads: RowThread[];
  /** Chips that are no bb thread (another harness's sessions). */
  tags: string[];
  /** What search looks in, besides the name and where. */
  search: string[];
};

/** Every word of the query appears in the name, where, a linking thread (its title too) or the row's own terms. */
export function matches(row: LinkRow, query: string, titles: Readonly<Record<string, string | null>> = {}): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(w => w !== "");
  if (words.length === 0) return true;
  const hay = [row.name, row.where, ...row.search, ...row.threads.flatMap(t => [t.id, titles[t.id] ?? ""])].join(" ").toLowerCase();
  return words.every(w => hay.includes(w));
}

/** What search shows: the scope's rows that match, then every other item that does (none for an empty query). */
export function searchSections(
  linked: readonly LinkRow[],
  available: readonly LinkRow[],
  query: string,
  titles: Readonly<Record<string, string | null>> = {},
): { linked: LinkRow[]; more: LinkRow[] } {
  const hits = linked.filter(r => matches(r, query, titles));
  if (query.trim() === "") return { linked: hits, more: [] };
  const listed = new Set(linked.map(r => r.key));
  return { linked: hits, more: available.filter(r => !listed.has(r.key) && matches(r, query, titles)) };
}

/** What a panel does with the rows a person selected. */
export type Action = "link" | "unlink" | "open";

/** Whether the thread links the row, by hand or by a write. */
export const linkedBy = (row: LinkRow, threadId: string): boolean => row.threads.some(t => t.id === threadId);

/**
 * The selected rows an action acts on: Link those the thread does not link yet, Unlink those it does (its own
 * links only, never another thread's), Open those still there. Gone items are not linked again.
 */
export function targets(action: Action, rows: readonly LinkRow[], threadId: string): LinkRow[] {
  if (action === "unlink") return rows.filter(r => linkedBy(r, threadId));
  return rows.filter(r => r.gone === null && (action === "open" || !linkedBy(r, threadId)));
}

/** The threads that link a row, newest first, once each. */
export function threadIds(row: LinkRow): string[] {
  return [...new Set([...row.threads].sort((a, b) => b.at - a.at).map(t => t.id))];
}

/** Whether every link from `threadId` is only claimed (a write's label), none made by hand. */
export function onlyClaimed(row: LinkRow, threadId: string): boolean {
  const mine = row.threads.filter(t => t.id === threadId);
  return mine.length > 0 && mine.every(t => t.claimed);
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

/** The row's time line: when it was last edited, else when it was linked, else nothing. */
export function timeLabel(row: Pick<LinkRow, "editedAt" | "linkedAt">, now: number): string {
  if (row.editedAt !== null) return `edited ${ago(row.editedAt, now)}`;
  return row.linkedAt !== null ? `linked ${ago(row.linkedAt, now)}` : "";
}
