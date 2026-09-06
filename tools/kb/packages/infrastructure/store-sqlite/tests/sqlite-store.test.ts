/**
 * What SqliteStore does that the port does not promise: the on-disk shape, the
 * two halves of the fingerprint, atomicity when a write fails part-way through
 * the transaction, and the paths it asks a watcher to watch.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Cause, Effect, Exit } from "effect";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, isDomainError, present, type KbNode } from "@kb/model";
import { SqliteStore, sqliteStoreFiles } from "../src/index.ts";

const AT = "2026-01-01T00:00:00.000Z";

function node(id: string, text: string): KbNode {
  return { id, text, props: {}, children: [], createdAt: AT, updatedAt: AT };
}

/** A scratch root plus an open store, both released when the scope closes. */
const scratchStore = Effect.gen(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "kb-sqlite-"))),
    (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
  );
  return yield* Effect.acquireRelease(
    Effect.sync(() => new SqliteStore(root)),
    (store) => Effect.sync(() => store.close()),
  );
});

/** Run `body` against a raw second connection to the same database. */
function withRawConnection(path: string, body: (db: Database) => void): void {
  const db = new Database(path);
  try {
    body(db);
  } finally {
    db.close(false);
  }
}

function failureOf(exit: Exit.Exit<unknown, unknown>): unknown {
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
}

describe("SqliteStore", () => {
  test("a store that is only read from never creates its file", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* scratchStore;
          expect(yield* store.loadEffect).toEqual([]);
          // Presence selects the adapter: a load that conjured the database
          // would make the selector see two stores under one root.
          expect(existsSync(store.path)).toBe(false);
        }),
      ),
    ));

  test("a node is one row whose body is the canonical JSON the JSONL also writes", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* scratchStore;
          const written = node("n-a", "a");
          yield* store.commitEffect({ upserts: [written], deletes: [] });

          withRawConnection(store.path, (db) => {
            const row = db
              .query<{ id: string; body: string }, []>("SELECT id, body FROM nodes")
              .get();
            expect(present(row, "expected a nodes row").id).toBe("n-a");
            expect(present(row, "expected a nodes row").body).toBe(canonicalJson(written));

            const version = db
              .query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'")
              .get();
            expect(present(version, "expected schema_version").value).toBe("1");
          });
        }),
      ),
    ));

  test("the fingerprint moves even when a commit changes no bytes", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* scratchStore;
          const same = node("n-a", "a");
          yield* store.commitEffect({ upserts: [same], deletes: [] });
          const before = yield* store.fingerprint;

          // Byte-identical content: what a size+mtime fingerprint cannot see,
          // and the reason `rev` exists. GAP 01M1PK5NYA7ZG3XC0H0YRYRVZE stays
          // open because the JSONL adapter still has that blind spot.
          yield* store.commitEffect({ upserts: [same], deletes: [] });
          expect(yield* store.fingerprint).not.toBe(before);
        }),
      ),
    ));

  test("a raw connection's write moves data_version, so the fingerprint moves", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* scratchStore;
          yield* store.commitEffect({ upserts: [node("n-a", "a")], deletes: [] });
          const before = yield* store.fingerprint;

          // A writer that bypasses `rev` entirely — the half `data_version` owns.
          withRawConnection(store.path, (db) => {
            db.prepare<unknown, [string, string]>("INSERT INTO nodes (id, body) VALUES (?, ?)").run(
              "n-b",
              canonicalJson(node("n-b", "b")),
            );
          });

          expect(yield* store.fingerprint).not.toBe(before);
        }),
      ),
    ));

  test("a write that fails part-way through the transaction leaves the store untouched", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* scratchStore;
          yield* store.commitEffect({ upserts: [node("n-a", "a")], deletes: [] });

          // Fail the second of two inserts, after the first has already been
          // written inside the transaction: nothing short of a real rollback
          // can leave the store as it was.
          withRawConnection(store.path, (db) => {
            db.run(
              `CREATE TRIGGER poison BEFORE INSERT ON nodes WHEN NEW.id = 'n-poison'
               BEGIN SELECT RAISE(ABORT, 'poisoned'); END`,
            );
          });
          // Taken after the trigger: installing it is itself another
          // connection's write, and the fingerprint is right to notice.
          const before = yield* store.fingerprint;

          const exit = yield* Effect.exit(
            store.commitEffect({
              upserts: [node("n-good", "good"), node("n-poison", "poison")],
              deletes: ["n-a"],
            }),
          );

          expect(Exit.isFailure(exit)).toBe(true);
          expect(isDomainError(failureOf(exit))).toBe(true);
          expect((yield* store.loadEffect).map((n) => n.id)).toEqual(["n-a"]);
          expect(yield* store.fingerprint).toBe(before);
        }),
      ),
    ));

  test("an undecodable row fails the whole load, naming that row", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* scratchStore;
          yield* store.commitEffect({ upserts: [node("n-a", "a")], deletes: [] });

          withRawConnection(store.path, (db) => {
            db.prepare<unknown, [string, string]>("INSERT INTO nodes (id, body) VALUES (?, ?)").run(
              "n-bad",
              '{"id":1}',
            );
          });

          const exit = yield* Effect.exit(store.loadEffect);
          const err = failureOf(exit);
          expect(isDomainError(err)).toBe(true);
          if (isDomainError(err)) {
            expect(err.code).toBe("invalid_input");
            expect(err.message).toContain("n-bad");
          }
        }),
      ),
    ));

  test("watchPaths is the database and its write-ahead log, never the shm", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* scratchStore;
          const [db, wal, shm] = sqliteStoreFiles(join(store.path, "..", ".."));
          expect(store.watchPaths).toEqual([present(db, "db"), present(wal, "wal")]);
          expect(store.watchPaths).not.toContain(present(shm, "shm"));
        }),
      ),
    ));
});
