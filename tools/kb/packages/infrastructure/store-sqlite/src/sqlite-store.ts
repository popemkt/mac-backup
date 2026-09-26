import { watch } from "node:fs";
import { basename, dirname } from "node:path";
import { Effect, Predicate, type Stream } from "effect";
import {
  canonicalJson,
  decodeStoredNode,
  domainError,
  isDomainError,
  type DomainError,
  type KbNode,
  type StoreTx,
} from "@kb/model";
import {
  fingerprintChanges,
  staleCommitError,
  type EffectStore,
  type StoreCommit,
  type StoreFingerprint,
  type TxRecord,
} from "@kb/contracts";
import { commitMark, sqliteConnection, type SqliteConnection } from "./connection.ts";
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
  readonly loadEffect: Effect.Effect<KbNode[], DomainError>;
  readonly fingerprint: Effect.Effect<StoreFingerprint | null>;
  /** The database and its write-ahead log; `-shm` is mapped memory, not news. */
  readonly changes: Stream.Stream<StoreFingerprint | null>;
  readonly txTail: SqliteTxTail;
  private readonly connection: SqliteConnection;

  constructor(root: string) {
    this.path = sqliteStorePath(root);
    this.connection = sqliteConnection(this.path);
    this.loadEffect = loadNodes(this.connection, this.path);
    this.fingerprint = fingerprintOf(this.connection);
    this.changes = fingerprintChanges({
      scopes: [
        {
          directory: dirname(this.path),
          names: new Set(
            sqliteStoreFiles(root)
              .slice(0, 2)
              .map((file) => basename(file)),
          ),
        },
      ],
      watch,
      fingerprint: this.fingerprint,
    });
    this.txTail = new SqliteTxTail(this.connection, this.path);
  }

  commitEffect(
    tx: StoreTx,
    record: TxRecord,
    expected?: StoreFingerprint,
  ): Effect.Effect<StoreCommit, DomainError> {
    const connection = this.connection;
    const path = this.path;
    const fingerprint = this.fingerprint;
    const txTail = this.txTail;
    return Effect.gen(function* () {
      const base = yield* commitTx(connection, path, { tx, record, expected }, txTail);
      return { base, fingerprint: yield* fingerprint };
    });
  }

  /** Release the connection. For tests and for `store.migrate`'s teardown. */
  close(): void {
    this.connection.close();
  }
}

interface CommitRequest {
  readonly tx: StoreTx;
  readonly record: TxRecord;
  readonly expected: StoreFingerprint | undefined;
}

/**
 * Run one commit and return the fingerprint it merged into. Read inside the
 * immediate transaction, after sqlite's write lock is taken, so `base` is the
 * state the writes below land on and a conditional commit is checked against
 * exactly that.
 */
function commitTx(
  connection: SqliteConnection,
  path: string,
  { tx, record, expected }: CommitRequest,
  txTail: SqliteTxTail,
): Effect.Effect<StoreFingerprint | null, DomainError> {
  return Effect.try({
    try: () => {
      const db = connection.open();
      const drop = db.prepare<unknown, [string]>("DELETE FROM nodes WHERE id = ?");
      const upsert = db.prepare<unknown, [string, string]>(
        `INSERT INTO nodes (id, body) VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET body = excluded.body`,
      );
      return db
        .transaction(() => {
          const base = commitMark(db);
          const stale = staleCommitError(expected, base);
          // Thrown to roll the transaction back; `catch` below passes it through.
          if (stale !== null) throw stale;
          for (const id of tx.deletes) drop.run(id);
          for (const node of tx.upserts) upsert.run(node.id, canonicalJson(node));
          // After the rows, whose triggers have moved `rev`, so the mark the
          // tail stamps is the one a reopen will read; inside the same
          // transaction, so on this backend the node rows and their log entry
          // are one act with no crash window between them. An empty
          // transaction is not recorded: it changes nothing and says nothing.
          if (tx.upserts.length > 0 || tx.deletes.length > 0) {
            txTail.appendWithin(db, tx, record);
          }
          return base;
        })
        .immediate();
    },
    catch: (err) => (isDomainError(err) ? err : mapCommitError(err, path)),
  });
}

/**
 * `meta.rev`, the count of row changes the database's own triggers keep. It
 * moves for every writer, a hand-run `sqlite3` included, and on every commit
 * that touches a row — even one whose content is byte-identical to what was
 * there, where JSONL's content hash deliberately does not. And it is the
 * database's, not the connection's, so every reader names one state alike.
 * Null when the file does not exist, and null compares equal to nothing.
 */
function fingerprintOf(connection: SqliteConnection): Effect.Effect<StoreFingerprint | null> {
  return Effect.sync(() => {
    try {
      const db = connection.peek();
      return db === null ? null : commitMark(db);
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
