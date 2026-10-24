// Linked items, the book the plugin keeps: which kb items each bb thread linked, read from kb's change log into
// the plugin's own database. No bb here: SQL, kb and "where a thread works" are handed in, so tests run it on
// node:sqlite and a fake kb (tests/link-book.test.ts). links.ts wires it to bb.
import type { Scope } from "../../linked-items/rows.ts";
import { KINDS, VIA_PREFIX, parseChangePage, touches, type How, type Kind, type LinkedItem } from "./links.ts";

/** The SQL the book needs: better-sqlite3 (bb.storage.database()) and node:sqlite both have it. */
export interface Sql {
  prepare(source: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

/** What the book needs of kb: one action, and the root it serves. */
export interface KbReader {
  call(id: string, input: Record<string, unknown>): Promise<{ ok: true; output: unknown } | { ok: false; message: string }>;
  root(): Promise<string | null>;
}

/** Where a thread works: its bb project and machine. */
export type Where = { project: string | null; host: string | null };

/** Append-only: bb.storage.migrate runs the ones a database has not seen. */
export const MIGRATIONS = [
  `CREATE TABLE items (store TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
     edited_at INTEGER, gone INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (store, id))`,
  `CREATE TABLE links (store TEXT NOT NULL, id TEXT NOT NULL, thread TEXT NOT NULL, project TEXT, host TEXT,
     how TEXT NOT NULL, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, PRIMARY KEY (store, id, thread))`,
  // gap_at: when kb's log first no longer reached back to the cursor, so links written meanwhile were missed.
  `CREATE TABLE cursor (store TEXT PRIMARY KEY, rev INTEGER NOT NULL, gap_at INTEGER)`,
];

/** The links listed for one thread and scope. */
export type Listing = {
  store: string | null;
  items: LinkedItem[];
  /** Why the list may be stale or empty: kb unreachable, or not configured. */
  error: string | null;
  /** When kb's log skipped past links the book had not read yet; null when it never did. */
  incomplete: number | null;
};

type Row = { id: string; kind: string; name: string; edited_at: number | null; gone: number; thread: string; host: string | null; how: string; last_at: number };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const canvasesNow = `[:find ?id ?text :where [?t :node/id "${KINDS.canvas.tag}"] [?n :f/sys.f.type ?t] [?n :node/id ?id] [?n :node/text ?text]]`;

export function linkBook(
  sql: Sql,
  kb: KbReader,
  whereIs: (threadId: string) => Promise<Where>,
  { page = 500, linksMax = 5000 }: { page?: number; linksMax?: number } = {},
) {
  /** An item a thread linked: its name, and when a thread last wrote it (null for a link by hand). */
  function remember(store: string, kind: Kind, id: string, name: string, editedAt: number | null) {
    sql
      .prepare(
        `INSERT INTO items (store, id, kind, name, edited_at, gone) VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT (store, id) DO UPDATE SET name = excluded.name, kind = excluded.kind, gone = 0,
           edited_at = CASE WHEN excluded.edited_at IS NULL THEN edited_at ELSE MAX(COALESCE(edited_at, 0), excluded.edited_at) END`,
      )
      .run(store, id, kind, name, editedAt);
  }

  /** A by-hand link stays one when the thread later writes the item too. */
  async function link(store: string, kind: Kind, id: string, name: string, threadId: string, how: How, at: number) {
    remember(store, kind, id, name, how === "wrote" ? at : null);
    const where = await whereIs(threadId);
    sql
      .prepare(
        `INSERT INTO links (store, id, thread, project, host, how, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (store, id, thread) DO UPDATE SET last_at = MAX(last_at, excluded.last_at),
           how = CASE WHEN links.how = 'linked' THEN 'linked' ELSE excluded.how END`,
      )
      .run(store, id, threadId, where.project, where.host, how, at, at);
  }

  /** Keep the newest `linksMax` links, and only items something still links. */
  function prune(store: string) {
    sql
      .prepare(`DELETE FROM links WHERE store = ? AND rowid IN (SELECT rowid FROM links WHERE store = ? ORDER BY last_at DESC LIMIT -1 OFFSET ?)`)
      .run(store, store, linksMax);
    sql.prepare(`DELETE FROM items WHERE store = ? AND NOT EXISTS (SELECT 1 FROM links l WHERE l.store = items.store AND l.id = items.id)`).run(store);
  }

  /** Read kb's log of thread writes from the cursor to its head. One run at a time. */
  let running: Promise<string> | null = null;
  function sync(): Promise<string> {
    running ??= (async () => {
      const root = await kb.root();
      if (root === null) throw new Error("kb did not say which root it serves");
      const cursor = sql.prepare("SELECT rev FROM cursor WHERE store = ?").get(root) as { rev: number } | undefined;
      let since = cursor?.rev ?? 0;
      let wrote = 0;
      for (;;) {
        const answer = await kb.call("graph.changes", { since, viaPrefix: VIA_PREFIX, limit: page });
        if (!answer.ok) throw new Error(answer.message);
        const changes = parseChangePage(answer.output);
        if (changes === null) throw new Error("this kb has no graph.changes yet; it needs a newer kb");
        for (const t of touches(changes.changes)) {
          if (t.gone) sql.prepare("UPDATE items SET gone = 1 WHERE store = ? AND id = ?").run(root, t.id);
          else if (t.thread !== null) {
            await link(root, t.kind, t.id, t.name, t.thread, "wrote", t.at);
            wrote++;
          }
        }
        // A log that no longer reaches back to the cursor (compacted, or another kb) carries on from its head, and
        // says so. Before a first cursor nothing was promised, so skipping there is no gap.
        const gap = !changes.complete && cursor !== undefined ? Date.now() : null;
        sql
          .prepare(
            `INSERT INTO cursor (store, rev, gap_at) VALUES (?, ?, ?)
             ON CONFLICT (store) DO UPDATE SET rev = excluded.rev, gap_at = COALESCE(cursor.gap_at, excluded.gap_at)`,
          )
          .run(root, changes.through, gap);
        if (changes.through >= changes.head || changes.through <= since) break;
        since = changes.through;
      }
      if (wrote > 0) prune(root);
      return root;
    })().finally(() => {
      running = null;
    });
    return running;
  }

  /** Names and deletions from anyone, not only threads: the canvases kb has now, in one query. */
  async function reconcile(store: string, items: LinkedItem[]) {
    const answer = await kb.call("graph.query", { query: canvasesNow }).catch(() => null);
    const rows = answer?.ok === true && typeof answer.output === "object" && answer.output !== null ? (answer.output as { rows?: unknown }).rows : null;
    if (!Array.isArray(rows)) return;
    const now = new Map(rows.filter((r): r is [string, string] => Array.isArray(r) && typeof r[0] === "string" && typeof r[1] === "string"));
    for (const item of items) {
      const name = now.get(item.id);
      const gone = name === undefined;
      if (gone === item.gone && (gone || name === item.name)) continue;
      item.gone = gone;
      if (name !== undefined && name !== "") item.name = name;
      sql.prepare("UPDATE items SET gone = ?, name = ? WHERE store = ? AND id = ?").run(gone ? 1 : 0, item.name, store, item.id);
    }
  }

  async function list(threadId: string, scope: Scope, label: (store: string) => string): Promise<Listing> {
    let error: string | null = null;
    let store: string | null = null;
    try {
      store = await sync();
    } catch (err) {
      error = `kb could not be read: ${message(err)}`;
      store = await kb.root().catch(() => null);
    }
    if (store === null) return { store, items: [], error: error ?? "kb is not reachable", incomplete: null };
    const where = await whereIs(threadId);
    const filter = scope === "session" ? "AND l.thread = ?" : scope === "project" ? "AND l.project = ?" : "";
    const args = scope === "session" ? [threadId] : scope === "project" ? [where.project ?? "\u0000none"] : [];
    const rows = sql
      .prepare(
        `SELECT i.id, i.kind, i.name, i.edited_at, i.gone, l.thread, l.host, l.how, l.last_at
         FROM links l JOIN items i ON i.store = l.store AND i.id = l.id
         WHERE l.store = ? ${filter} ORDER BY l.last_at DESC`,
      )
      .all(store, ...args) as Row[];
    const byId = new Map<string, LinkedItem>();
    for (const r of rows) {
      let item = byId.get(r.id);
      if (item === undefined) {
        item = {
          key: r.id,
          kind: r.kind in KINDS ? (r.kind as Kind) : "canvas",
          id: r.id,
          name: r.name === "" ? r.id : r.name,
          store: label(store),
          editedAt: r.edited_at,
          linkedAt: r.last_at,
          gone: r.gone === 1,
          open: false,
          threads: [],
        };
        byId.set(r.id, item);
      }
      item.threads.push({ id: r.thread, how: r.how === "linked" ? "linked" : "wrote", at: r.last_at, host: r.host });
    }
    const items = [...byId.values()];
    if (error === null) await reconcile(store, items);
    const gap = sql.prepare("SELECT gap_at FROM cursor WHERE store = ?").get(store) as { gap_at: number | null } | undefined;
    return { store, items, error, incomplete: gap?.gap_at ?? null };
  }

  return { sync, link, list };
}
