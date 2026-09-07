import { Effect, Predicate } from "effect";
import {
  canonicalJson,
  decodeStoredNode,
  domainError,
  type DomainError,
  type KbNode,
  type StoreTx,
} from "@kb/model";
import type { EffectStore, StoreCommit, StoreFingerprint, TxRecord } from "@kb/contracts";
import { sqliteConnection, type SqliteConnection } from "./connection.ts";
import { sqliteStoreFiles, sqliteStorePath } from "./paths.ts";
import { SqliteTxTail } from "./tx-tail.ts";

interface NodeRow {
  id: string;
  body: string;
}

/** The `code` of a thrown sqlite/fs error, when it carries one. */
function errnoCode(err: unknown): string {
  return Predicate.hasProperty(err, "code") && typeof err.code === "string" ? err.code : "";
}

/**
 * A write that lost a race is a `conflict`, everything else is `internal` —
 * the same two answers `@kb/store-jsonl` gives, so a caller handling a
 * contended commit does not have to know which adapter it got.
 */
function mapCommitError(err: unknown, path: string): DomainError {
  const code = errnoCode(err);
  const message = err instanceof Error ? err.message : String(err);
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") {
    return domainError("conflict", `store busy: ${message}`, { path, code });
  }
  return domainError("internal", `commit ${path}: ${message}`, { path });
}

/**
 * SQLite backend: `<root>/.kb/kb.sqlite`.
 *
 * A row per node — `id` primary key, `body` the same `canonicalJson(node)` the
 * JSONL adapter writes — plus a `meta` table holding `schema_version` and
 * `rev`, a counter this store bumps inside every commit. Not a column per
 * field: a node's bytes are what the store promises to give back, and DDL that
 * mirrored the node schema would be a second, partial copy of it.
 *
 * Commits are one `BEGIN IMMEDIATE … COMMIT` covering deletes, upserts and the
 * `rev` bump. There is no `.lock` file: sqlite's own write lock already is one,
 * and a second mechanism beside it would be the one that lies.
 *
 * Load is all-or-nothing like JSONL's: one undecodable row fails the whole
 * load, naming that row's id, and nothing is rewritten.
 */
export class SqliteStore implements EffectStore {
  readonly path: string;
  /** The database and its write-ahead log; `-shm` is mapped memory, not news. */
  readonly watchPaths: readonly string[];
  readonly loadEffect: Effect.Effect<KbNode[], DomainError>;
  readonly fingerprint: Effect.Effect<StoreFingerprint | null>;
  readonly txTail: SqliteTxTail;
  private readonly connection: SqliteConnection;

  constructor(root: string) {
    this.path = sqliteStorePath(root);
    this.watchPaths = sqliteStoreFiles(root).slice(0, 2);
    this.connection = sqliteConnection(this.path);
    this.loadEffect = loadNodes(this.connection, this.path);
    this.fingerprint = fingerprintOf(this.connection);
    this.txTail = new SqliteTxTail(this.connection, this.path);
  }

  commitEffect(tx: StoreTx, record: TxRecord): Effect.Effect<StoreCommit, DomainError> {
    const connection = this.connection;
    const path = this.path;
    const fingerprint = this.fingerprint;
    const txTail = this.txTail;
    return Effect.gen(function* () {
      // Read before the immediate transaction opens: `rev` and `data_version`
      // together name the state that transaction merges into.
      const base = yield* fingerprint;
      yield* commitTx(connection, path, tx, record, txTail);
      return { base, fingerprint: yield* fingerprint };
    });
  }

  /** Release the connection. For tests and for `store.migrate`'s teardown. */
  close(): void {
    this.connection.close();
  }
}

function commitTx(
  connection: SqliteConnection,
  path: string,
  tx: StoreTx,
  record: TxRecord,
  txTail: SqliteTxTail,
): Effect.Effect<void, DomainError> {
  return Effect.try({
    try: () => {
      const db = connection.open();
      const drop = db.prepare<unknown, [string]>("DELETE FROM nodes WHERE id = ?");
      const upsert = db.prepare<unknown, [string, string]>(
        `INSERT INTO nodes (id, body) VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET body = excluded.body`,
      );
      const bumpRev = db.prepare(
        "UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'rev'",
      );
      db.transaction(() => {
        for (const id of tx.deletes) drop.run(id);
        for (const node of tx.upserts) upsert.run(node.id, canonicalJson(node));
        bumpRev.run();
        // After the bump, so the mark the tail stamps is the one a reopen will
        // read; inside the same transaction, so on this backend the node rows
        // and their log entry are one act with no crash window between them.
        // An empty transaction is not recorded: it costs a rev and a frame and
        // says nothing.
        if (tx.upserts.length > 0 || tx.deletes.length > 0) {
          txTail.appendWithin(db, tx, record);
        }
      }).immediate();
    },
    catch: (err) => mapCommitError(err, path),
  });
}

/**
 * `rev` plus sqlite's `data_version`.
 *
 * `rev` moves on every commit, including one whose content is byte-identical
 * to what was already there — the case a size+mtime fingerprint cannot see.
 * `data_version` moves when another connection commits, which catches a writer
 * that bypassed `rev` altogether (a `VACUUM`, a hand-run `sqlite3`). Null when
 * the file does not exist, and null compares equal to nothing.
 */
function fingerprintOf(connection: SqliteConnection): Effect.Effect<StoreFingerprint | null> {
  return Effect.sync(() => {
    try {
      const db = connection.peek();
      if (db === null) return null;
      const rev = db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'rev'").get();
      const version = db.query<{ data_version: number }, []>("PRAGMA data_version").get();
      if (rev === null || version === null) return null;
      return `${rev.value}:${String(version.data_version)}`;
    } catch {
      // The port promises no failure here; a store that cannot say says null.
      return null;
    }
  });
}

function loadNodes(
  connection: SqliteConnection,
  path: string,
): Effect.Effect<KbNode[], DomainError> {
  return Effect.suspend(() => {
    let rowId = "";
    return Effect.try({
      try: () => {
        const db = connection.peek();
        if (db === null) return [];
        const rows = db.query<NodeRow, []>("SELECT id, body FROM nodes ORDER BY id").all();
        // Accumulate only after every row validates — one bad row fails the
        // whole load, so no caller ever sees a partial KbNode[].
        const nodes: KbNode[] = [];
        for (const row of rows) {
          rowId = row.id;
          nodes.push(decodeStoredNode(JSON.parse(row.body)));
        }
        return nodes;
      },
      catch: (err) =>
        domainError(
          "invalid_input",
          `invalid node at ${path}#${rowId}: ${err instanceof Error ? err.message : String(err)}`,
          { path, id: rowId },
        ),
    });
  });
}
