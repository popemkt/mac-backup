import { Database } from "bun:sqlite";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYSTEM_IDS, fieldTypeValue, systemSeedNodes, type KbTx, type PropValue } from "@kb/model";
import { DatascriptIndex } from "@kb/query";
import {
  STORE_BACKENDS,
  createStore,
  selectStore,
  type StoreBackend,
  bunFileSystemLayer,
} from "@kb/runtime";
import { KbClientError, openClient, type KbNode } from "../src/index.ts";

const AT = "2026-09-19T00:00:00.000Z";
const roots: string[] = [];

function withFs<A, E>(effect: Effect.Effect<A, E, FileSystem>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(bunFileSystemLayer)));
}

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "kb-client-"));
  roots.push(root);
  return root;
}

/** A root holding an empty store of `backend`, as `kb init --store` makes it. */
async function workspace(backend: StoreBackend): Promise<string> {
  const root = scratch();
  await withFs(createStore(root, backend));
  return root;
}

/** The transaction tail of whichever store the root has. */
async function tailOf(root: string): Promise<readonly KbTx[]> {
  const store = await withFs(selectStore(root));
  return store.txTail.entries();
}

function node(id: string, text = id): KbNode {
  return { id, text, props: {}, children: [], createdAt: AT, updatedAt: AT };
}

/** The rejection's code, so a test can say which failure it expects. */
function codeOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "resolved",
    (err: unknown) =>
      err instanceof KbClientError ? err.code : `not a KbClientError: ${String(err)}`,
  );
}

/** A write that goes around kb entirely: an editor, or a hand-run `sqlite3`. */
const externalEdit: Record<StoreBackend, (root: string, from: string, to: string) => void> = {
  jsonl: (root, from, to) => {
    const path = join(root, ".kb/nodes.jsonl");
    writeFileSync(path, readFileSync(path, "utf8").replace(from, to));
  },
  sqlite: (root, from, to) => {
    const db = new Database(join(root, ".kb/kb.sqlite"));
    db.run("UPDATE nodes SET body = replace(body, ?, ?)", [from, to]);
    db.close();
  },
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.each([...STORE_BACKENDS])("over a %s store", (backend) => {
  test("a stale batch is rejected with no node write and no log entry", async () => {
    const root = await workspace(backend);
    const first = await openClient(root);
    const second = await openClient(root);
    const old = await second.snapshot();
    const committed = await first.commit({
      expectedRevision: old.revision,
      upserts: [node("parent"), node("child")],
      deletes: [],
      origin: "first",
    });

    expect(
      await codeOf(
        second.commit({
          expectedRevision: old.revision,
          upserts: [node("leak")],
          deletes: ["parent"],
        }),
      ),
    ).toBe("conflict");
    expect(await second.snapshot()).toEqual(committed);
    expect((await tailOf(root)).map((tx) => [tx.origin, tx.ops.upserts.map((n) => n.id)])).toEqual([
      ["first", ["parent", "child"]],
    ]);
  });

  test("a batch is checked as a whole graph, keeps foreign keys, and queries see it", async () => {
    const root = await workspace(backend);
    const writer = await openClient(root);
    const reader = await openClient(root);
    const empty = await writer.snapshot();
    const foreign = { ...node("foreign"), order: "a", extra: { nested: [1, 2] } };
    const parent = { ...node("parent"), order: "b", children: ["child"] };
    const saved = await writer.commit({
      expectedRevision: empty.revision,
      upserts: [foreign, parent, node("child")],
      deletes: [],
    });
    const ids = await reader.query("[:find ?id :where [?n :node/id ?id]]");
    expect(ids.revision).toBe(saved.revision);
    expect(ids.rows.map(([id]) => String(id)).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "child",
      "foreign",
      "parent",
    ]);

    // Deleting a child its parent still lists would orphan the outline.
    expect(
      await codeOf(
        writer.commit({ expectedRevision: saved.revision, upserts: [], deletes: ["child"] }),
      ),
    ).toBe("invalid_input");
    expect((await reader.snapshot()).revision).toBe(saved.revision);

    const changed = await writer.commit({
      expectedRevision: saved.revision,
      upserts: [{ ...parent, text: "changed" }],
      deletes: [],
    });
    expect(changed.nodes.find((n) => n.id === "foreign")).toEqual(foreign);
    const text = await reader.query(
      "[:find ?text :in $ ?id :where [?n :node/id ?id] [?n :node/text ?text]]",
      ["parent"],
    );
    expect(text).toEqual({ revision: changed.revision, rows: [["changed"]] });
  });

  test("the committed snapshot is what the next read returns", async () => {
    const client = await openClient(await workspace(backend));
    const empty = await client.snapshot();
    const committed = await client.commit({
      expectedRevision: empty.revision,
      upserts: [node("b"), node("a"), node("C")],
      deletes: [],
    });
    expect(await client.snapshot()).toEqual(committed);
    expect(committed.nodes.map((n) => n.id)).toEqual(["C", "a", "b"]);
  });

  test("an external edit invalidates the revision it was read at", async () => {
    const root = await workspace(backend);
    const client = await openClient(root);
    const empty = await client.snapshot();
    const saved = await client.commit({
      expectedRevision: empty.revision,
      upserts: [node("one", "before")],
      deletes: [],
    });
    externalEdit[backend](root, "before", "after!");

    expect(
      await codeOf(
        client.commit({ expectedRevision: saved.revision, upserts: [node("two")], deletes: [] }),
      ),
    ).toBe("conflict");
    expect((await client.snapshot()).nodes.map((n) => n.text)).toEqual(["after!"]);
  });

  test("a query answers from the held index until the store moves, then from the new state", async () => {
    const root = await workspace(backend);
    const client = await openClient(root);
    const empty = await client.snapshot();
    const saved = await client.commit({
      expectedRevision: empty.revision,
      upserts: [node("one", "before")],
      deletes: [],
    });
    const texts = "[:find ?text :where [?n :node/text ?text]]";
    // Every index build, the constructor's included, goes through rebuild.
    const rebuilds = spyOn(DatascriptIndex.prototype, "rebuild");
    try {
      expect(await client.query(texts)).toEqual({ revision: saved.revision, rows: [["before"]] });
      expect(rebuilds).toHaveBeenCalledTimes(1);
      expect(await client.query(texts)).toEqual({ revision: saved.revision, rows: [["before"]] });
      expect(rebuilds).toHaveBeenCalledTimes(1);

      externalEdit[backend](root, "before", "after!");
      const moved = await client.query(texts);
      expect(rebuilds).toHaveBeenCalledTimes(2);
      expect(moved.revision).not.toBe(saved.revision);
      expect(moved).toEqual({ revision: (await client.snapshot()).revision, rows: [["after!"]] });
    } finally {
      rebuilds.mockRestore();
    }
  });

  test("a malformed upsert rejects the whole batch before anything is stored", async () => {
    const client = await openClient(await workspace(backend));
    const empty = await client.snapshot();
    expect(
      await codeOf(
        client.commit({
          expectedRevision: empty.revision,
          upserts: [
            node("valid"),
            { ...node("bad"), props: { count: [{ t: "num", v: Number.NaN }] } },
          ],
          deletes: [],
        }),
      ),
    ).toBe("invalid_input");
    expect(await client.snapshot()).toEqual(empty);
  });

  test("a value its field's declared type does not accept is refused, and nothing is stored", async () => {
    const client = await openClient(await workspace(backend));
    const empty = await client.snapshot();
    const estimate = {
      ...node("f.estimate", "estimate"),
      props: {
        [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: SYSTEM_IDS.field }],
        [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("number")],
      },
    };
    const seeded = await client.commit({
      expectedRevision: empty.revision,
      upserts: [...systemSeedNodes(AT), estimate],
      deletes: [],
    });
    const task = (value: PropValue): KbNode => ({
      ...node("n.task"),
      props: { "f.estimate": [value] },
    });
    expect(
      await codeOf(
        client.commit({
          expectedRevision: seeded.revision,
          upserts: [task({ t: "str", v: "banana" })],
          deletes: [],
        }),
      ),
    ).toBe("invalid_input");
    expect((await client.snapshot()).revision).toBe(seeded.revision);
    const landed = await client.commit({
      expectedRevision: seeded.revision,
      upserts: [task({ t: "num", v: 3 })],
      deletes: [],
    });
    expect(landed.nodes.find((n) => n.id === "n.task")?.props["f.estimate"]).toEqual([
      { t: "num", v: 3 },
    ]);
  });

  test("a malformed query is an invalid_input error", async () => {
    const client = await openClient(await workspace(backend));
    expect(await codeOf(client.query("[:find"))).toBe("invalid_input");
  });

  test("two clients committing from one snapshot: exactly one lands", async () => {
    const root = await workspace(backend);
    const first = await openClient(root);
    const second = await openClient(root);
    const before = await first.snapshot();
    const codes = await Promise.all([
      codeOf(
        first.commit({ expectedRevision: before.revision, upserts: [node("first")], deletes: [] }),
      ),
      codeOf(
        second.commit({
          expectedRevision: before.revision,
          upserts: [node("second")],
          deletes: [],
        }),
      ),
    ]);
    expect(codes.toSorted()).toEqual(["conflict", "resolved"]);
    expect((await first.snapshot()).nodes).toHaveLength(1);
    expect(await tailOf(root)).toHaveLength(1);
  });
});

describe("choosing the store", () => {
  test("a root with no store reads as an empty JSONL store and writes nothing", async () => {
    const root = scratch();
    const snapshot = await (await openClient(root)).snapshot();
    expect(snapshot.nodes).toEqual([]);
    expect(existsSync(join(root, ".kb"))).toBe(false);
  });

  test("a root with both stores is refused rather than guessed at", async () => {
    const root = await workspace("sqlite");
    writeFileSync(join(root, ".kb/nodes.jsonl"), "");
    expect(await codeOf(openClient(root))).toBe("conflict");
  });
});
