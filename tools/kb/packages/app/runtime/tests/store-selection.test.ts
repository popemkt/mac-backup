/**
 * Which store a root gets, and what moving between them does to the files.
 *
 * Never runs against the repo's own `.kb/`: every case builds its own scratch
 * root, and the migration cases assert on files inside it.
 */
import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDomainError, present, type DomainError, type KbNode } from "@kb/model";
import type { FileSystem } from "effect/FileSystem";
import { bunFileSystemLayer, JsonlStore } from "@kb/store-jsonl";
import { SqliteStore } from "@kb/store-sqlite";
import { createStore, migrateStore, selectStore } from "../src/store-selection.ts";
import { openKbEffect } from "../src/layers.ts";

const AT = "2026-01-01T00:00:00.000Z";

function node(id: string, text: string): KbNode {
  return { id, text, props: {}, children: [], createdAt: AT, updatedAt: AT };
}

const scratchRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "kb-select-"))),
  (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
);

/** Run one case against a scratch root with the Bun filesystem provided. */
function withRoot<A>(
  body: (root: string) => Effect.Effect<A, DomainError, FileSystem>,
): Promise<Exit.Exit<A, DomainError>> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        return yield* Effect.exit(body(yield* scratchRoot));
      }),
    ).pipe(Effect.provide(bunFileSystemLayer)),
  );
}

function failureOf(exit: Exit.Exit<unknown, DomainError>): unknown {
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
}

function succeeded<A>(exit: Exit.Exit<A, DomainError>): A {
  if (Exit.isFailure(exit)) throw new Error(String(Cause.squash(exit.cause)));
  return exit.value;
}

describe("selectStore", () => {
  test("a root with neither store gets JSONL", async () => {
    const exit = await withRoot((root) => selectStore(root));
    expect(succeeded(exit)).toBeInstanceOf(JsonlStore);
  });

  test("a root whose .kb/kb.sqlite exists gets sqlite", async () => {
    const exit = await withRoot((root) =>
      Effect.gen(function* () {
        yield* createStore(root, "sqlite");
        return yield* selectStore(root);
      }),
    );
    expect(succeeded(exit)).toBeInstanceOf(SqliteStore);
  });

  test("a root with both stores is refused, naming both paths", async () => {
    const exit = await withRoot((root) =>
      Effect.gen(function* () {
        const jsonl = new JsonlStore(root);
        yield* jsonl.commitEffect({ upserts: [node("n-a", "a")], deletes: [] });
        const sqlite = new SqliteStore(root);
        yield* sqlite.commitEffect({ upserts: [node("n-a", "a")], deletes: [] });
        sqlite.close();
        return yield* selectStore(root);
      }),
    );
    const err = failureOf(exit);
    expect(isDomainError(err)).toBe(true);
    if (isDomainError(err)) {
      expect(err.code).toBe("conflict");
      expect(err.message).toContain("nodes.jsonl");
      expect(err.message).toContain("kb.sqlite");
    }
  });

  test("a session opened after `init --store sqlite` runs on sqlite", async () => {
    const exit = await withRoot((root) =>
      Effect.gen(function* () {
        yield* createStore(root, "sqlite");
        const ctx = yield* openKbEffect(root);
        // The seed committed through the store the selector chose, and nothing
        // wrote a stray nodes.jsonl beside it.
        expect(ctx.store).toBeInstanceOf(SqliteStore);
        expect(ctx.nodes.length).toBeGreaterThan(0);
        expect(existsSync(join(root, ".kb", "nodes.jsonl"))).toBe(false);
        return ctx.store;
      }),
    );
    succeeded(exit);
  });

  test("createStore refuses to add a second backend to a root that has one", async () => {
    const exit = await withRoot((root) =>
      Effect.gen(function* () {
        yield* new JsonlStore(root).commitEffect({ upserts: [node("n-a", "a")], deletes: [] });
        return yield* createStore(root, "sqlite");
      }),
    );
    const err = failureOf(exit);
    expect(isDomainError(err)).toBe(true);
    if (isDomainError(err)) expect(err.code).toBe("conflict");
  });
});

describe("migrateStore", () => {
  test("jsonl → sqlite → jsonl keeps every node and leaves one store behind", async () => {
    const exit = await withRoot((root) =>
      Effect.gen(function* () {
        const written = [node("n-a", "a"), node("n-b", "b"), node("n-c", "c")];
        yield* new JsonlStore(root).commitEffect({ upserts: written, deletes: [] });

        const toSqlite = yield* migrateStore(root, "sqlite");
        expect(toSqlite).toMatchObject({ from: "jsonl", to: "sqlite", nodes: 3 });
        expect(existsSync(join(root, ".kb", "nodes.jsonl"))).toBe(false);
        expect(existsSync(join(root, ".kb", "nodes.jsonl.bak"))).toBe(false);
        expect(existsSync(join(root, ".kb", "kb.sqlite"))).toBe(true);

        const onSqlite = yield* selectStore(root);
        expect(onSqlite).toBeInstanceOf(SqliteStore);
        expect((yield* onSqlite.loadEffect).map((n) => n.text)).toEqual(["a", "b", "c"]);

        const back = yield* migrateStore(root, "jsonl");
        expect(back).toMatchObject({ from: "sqlite", to: "jsonl", nodes: 3 });
        for (const suffix of ["", "-wal", "-shm"]) {
          expect(existsSync(join(root, ".kb", `kb.sqlite${suffix}`))).toBe(false);
        }

        const onJsonl = yield* selectStore(root);
        expect(onJsonl).toBeInstanceOf(JsonlStore);
        return yield* onJsonl.loadEffect;
      }),
    );
    expect(succeeded(exit)).toEqual([node("n-a", "a"), node("n-b", "b"), node("n-c", "c")]);
  });

  test("migrating to the backend a root already has is refused", async () => {
    const exit = await withRoot((root) =>
      Effect.gen(function* () {
        yield* new JsonlStore(root).commitEffect({ upserts: [node("n-a", "a")], deletes: [] });
        return yield* migrateStore(root, "jsonl");
      }),
    );
    const err = failureOf(exit);
    expect(isDomainError(err)).toBe(true);
    if (isDomainError(err)) expect(err.code).toBe("conflict");
  });

  test("migrating a root with no store at all is not_found", async () => {
    const exit = await withRoot((root) => migrateStore(root, "sqlite"));
    const err = failureOf(exit);
    expect(isDomainError(err)).toBe(true);
    if (isDomainError(err)) expect(err.code).toBe("not_found");
  });

  test("a migrated session sees the same graph the old one did", async () => {
    const exit = await withRoot((root) =>
      Effect.gen(function* () {
        const before = yield* openKbEffect(root);
        const seeded = before.nodes.map((n) => n.id).toSorted();
        yield* migrateStore(root, "sqlite");
        const after = yield* openKbEffect(root);
        expect(after.store).toBeInstanceOf(SqliteStore);
        return { seeded, after: after.nodes.map((n) => n.id).toSorted() };
      }),
    );
    const result = succeeded(exit);
    expect(present(result, "expected a result").after).toEqual(result.seeded);
  });
});
