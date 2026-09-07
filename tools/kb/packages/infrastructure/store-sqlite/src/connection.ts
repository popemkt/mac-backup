/**
 * The store's one connection to `.kb/kb.sqlite`.
 *
 * Opened lazily and kept for the store's lifetime: `EffectStore` is built once
 * per session and handed around as a plain value — layers, actions and the
 * watcher all hold it and none of them has a scope to hang a connection off —
 * so the only owner with the right lifetime is the store itself.
 *
 * {@link SqliteConnection.peek} is the half that makes presence-based selection
 * work: reads must never bring the file into existence, or a store that was
 * only ever loaded from would make the selector see two stores under one root.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The same ceiling `@kb/store-jsonl`'s advisory lock spends waiting, so a
 * contended commit behaves the same on both adapters instead of failing fast
 * on one and spinning on the other.
 */
const BUSY_TIMEOUT_MS = 15_000;

/** Bumped when the table shape changes; stored in `meta` so a file can say. */
const SCHEMA_VERSION = "2";

export interface SqliteConnection {
  /** Open the database, creating the file and schema when absent. */
  open: () => Database;
  /** The open handle, or one for an existing file — never creates the file. */
  peek: () => Database | null;
  /** Drop the handle. Tests own store lifetimes; production has one session. */
  close: () => void;
}

function initialize(db: Database): void {
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run(`PRAGMA busy_timeout = ${String(BUSY_TIMEOUT_MS)}`);
  db.run("CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
  db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  // The store's durable transaction tail; see `tx-tail.ts` for what each
  // column is for. `IF NOT EXISTS` is the whole migration from schema 1: the
  // table is additive and an existing database gains an empty tail, which is
  // exactly the state `TxTail.isCurrent` already knows how to report.
  db.run(
    `CREATE TABLE IF NOT EXISTS tx (
       rev INTEGER PRIMARY KEY,
       at TEXT NOT NULL,
       origin TEXT,
       ops TEXT NOT NULL,
       mark TEXT NOT NULL
     )`,
  );
  db.run(
    `INSERT INTO meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}'), ('rev', '0')
     ON CONFLICT(key) DO NOTHING`,
  );
  db.run(`UPDATE meta SET value = '${SCHEMA_VERSION}' WHERE key = 'schema_version'`);
}

export function sqliteConnection(path: string): SqliteConnection {
  let handle: Database | null = null;

  const open = (): Database => {
    if (handle !== null) return handle;
    mkdirSync(dirname(path), { recursive: true });
    const opened = new Database(path, { create: true });
    initialize(opened);
    handle = opened;
    return opened;
  };

  return {
    open,
    peek: () => (handle !== null ? handle : existsSync(path) ? open() : null),
    close: () => {
      handle?.close(false);
      handle = null;
    },
  };
}
