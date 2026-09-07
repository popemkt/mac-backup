/**
 * The SQLite store's durable transaction tail: a `tx` table in the same
 * database as the nodes.
 *
 * ```sql
 * CREATE TABLE tx (rev INTEGER PRIMARY KEY, at TEXT NOT NULL,
 *                  origin TEXT, ops TEXT NOT NULL, mark TEXT NOT NULL);
 * ```
 *
 * `ops` is the `canonicalJson` of the `StoreTx` — the nodes' own bytes again,
 * for the same reason the `nodes` table stores a body rather than a column per
 * field. `mark` is the store's own durable commit mark (`meta.rev`) as of that
 * append, which is what {@link SqliteTxTail.isCurrent} compares; `meta.rev`
 * rather than the fingerprint because `PRAGMA data_version` is meaningless
 * across connections and a mark that could not be compared after a reopen
 * would answer nothing.
 *
 * `rev` is the tail's own counter, not `meta.rev`: `meta.rev` also moves for a
 * commit that records nothing (the empty write `kb init --store sqlite` makes),
 * and a sequence with holes in it is a sequence a reader cannot tell from a
 * compacted one.
 *
 * The row goes in inside the store's own `BEGIN IMMEDIATE`, so here the node
 * write and the record really are one act — there is no window for a crash to
 * land in and no order to choose. {@link SqliteTxTail.append} exists for the
 * transactions the store did not commit (the saved-query virtual set) and
 * wraps itself in one.
 */
import type { Database } from "bun:sqlite";
import { canonicalJson, decodeStoredTx, domainError, type KbTx, type StoreTx } from "@kb/model";
import {
  TX_TAIL_KEEP_ENTRIES,
  TX_TAIL_MAX_ENTRIES,
  type TxRecord,
  type TxTail,
} from "@kb/contracts";
import type { SqliteConnection } from "./connection.ts";

interface TxRow {
  rev: number;
  at: string;
  origin: string | null;
  ops: string;
}

/** The store's durable commit mark: the `meta.rev` counter every commit bumps. */
function storeMark(db: Database): string {
  const row = db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'rev'").get();
  return row?.value ?? "";
}

function toKbTx(row: TxRow): KbTx {
  return decodeStoredTx({
    rev: row.rev,
    at: row.at,
    ops: JSON.parse(row.ops),
    ...(row.origin === null ? {} : { origin: row.origin }),
  });
}

export class SqliteTxTail implements TxTail {
  private readonly connection: SqliteConnection;
  private readonly path: string;

  constructor(connection: SqliteConnection, path: string) {
    this.connection = connection;
    this.path = path;
  }

  head(): number {
    const db = this.connection.peek();
    if (db === null) return 0;
    return db.query<{ rev: number | null }, []>("SELECT MAX(rev) AS rev FROM tx").get()?.rev ?? 0;
  }

  isCurrent(): boolean {
    const db = this.connection.peek();
    // No database is no store and no tail: a consistent empty pair.
    if (db === null) return true;
    const last = db
      .query<{ mark: string }, []>("SELECT mark FROM tx ORDER BY rev DESC LIMIT 1")
      .get();
    // An empty tail is current only while the store is empty too. `meta.rev`
    // counts commits, so "0" is the untouched store.
    if (last === null) return storeMark(db) === "0";
    return last.mark === storeMark(db);
  }

  entries(): KbTx[] {
    const db = this.connection.peek();
    if (db === null) return [];
    return db
      .query<TxRow, []>("SELECT rev, at, origin, ops FROM tx ORDER BY rev")
      .all()
      .map(toKbTx);
  }

  append(ops: StoreTx, record: TxRecord): KbTx {
    try {
      const db = this.connection.open();
      return db.transaction(() => this.appendWithin(db, ops, record)).immediate();
    } catch (err) {
      throw domainError(
        "internal",
        `append tx tail ${this.path}: ${err instanceof Error ? err.message : String(err)}`,
        { path: this.path },
      );
    }
  }

  adopt(txs: readonly KbTx[]): void {
    const db = this.connection.open();
    const kept = txs.slice(-TX_TAIL_KEEP_ENTRIES);
    db.transaction(() => {
      db.run("DELETE FROM tx");
      const mark = storeMark(db);
      const insert = db.prepare<unknown, [number, string, string | null, string, string]>(
        "INSERT INTO tx (rev, at, origin, ops, mark) VALUES (?, ?, ?, ?, ?)",
      );
      for (const tx of kept) {
        insert.run(tx.rev, tx.at, tx.origin ?? null, canonicalJson(tx.ops), mark);
      }
    }).immediate();
  }

  /**
   * Insert one record inside a transaction the caller already opened — how the
   * store records its own commits, and the reason there is no crash window
   * between the node rows and the log entry on this backend.
   */
  appendWithin(db: Database, ops: StoreTx, record: TxRecord): KbTx {
    const rev =
      (db.query<{ rev: number | null }, []>("SELECT MAX(rev) AS rev FROM tx").get()?.rev ?? 0) + 1;
    db.prepare<unknown, [number, string, string | null, string, string]>(
      "INSERT INTO tx (rev, at, origin, ops, mark) VALUES (?, ?, ?, ?, ?)",
    ).run(rev, record.at, record.origin ?? null, canonicalJson(ops), storeMark(db));

    // Compaction is part of the same transaction: a tail that shed its head
    // in a separate write could be observed with neither bound in force.
    const count = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM tx").get()?.n ?? 0;
    if (count > TX_TAIL_MAX_ENTRIES) {
      db.prepare<unknown, [number]>(
        "DELETE FROM tx WHERE rev <= (SELECT MAX(rev) - ? FROM tx)",
      ).run(TX_TAIL_KEEP_ENTRIES);
    }

    return record.origin === undefined
      ? { rev, ops, at: record.at }
      : { rev, ops, at: record.at, origin: record.origin };
  }
}
