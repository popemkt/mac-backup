import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlStore } from "@kb/store-jsonl";
import { KbClientError, openJsonlClient, type KbNode } from "../src/index.ts";

const AT = "2026-09-19T00:00:00.000Z";
const roots: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "kb-client-"));
  roots.push(root);
  return root;
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

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("reading an absent store writes nothing", async () => {
  const root = workspace();
  const snapshot = await openJsonlClient(root).snapshot();
  expect(snapshot.nodes).toEqual([]);
  expect(() => readFileSync(join(root, ".kb/nodes.jsonl"))).toThrow();
});

test("a stale batch is rejected with no node write and no log entry", async () => {
  const root = workspace();
  const first = openJsonlClient(root);
  const second = openJsonlClient(root);
  const old = await second.snapshot();
  const committed = await first.commit({
    expectedRevision: old.revision,
    upserts: [node("parent"), node("child")],
    deletes: [],
    origin: "first",
  });
  const nodesBytes = readFileSync(join(root, ".kb/nodes.jsonl"), "utf8");
  const tailBytes = readFileSync(join(root, ".kb/tx.jsonl"), "utf8");

  expect(
    await codeOf(
      second.commit({
        expectedRevision: old.revision,
        upserts: [node("leak")],
        deletes: ["parent"],
      }),
    ),
  ).toBe("conflict");
  expect(readFileSync(join(root, ".kb/nodes.jsonl"), "utf8")).toBe(nodesBytes);
  expect(readFileSync(join(root, ".kb/tx.jsonl"), "utf8")).toBe(tailBytes);
  expect(await second.snapshot()).toEqual(committed);

  const txs = new JsonlStore(root).txTail.entries();
  expect(txs.map((tx) => [tx.origin, tx.ops.upserts.map((n) => n.id)])).toEqual([
    ["first", ["parent", "child"]],
  ]);
});

test("a batch is checked as a whole graph, keeps foreign keys, and queries see it", async () => {
  const root = workspace();
  const writer = openJsonlClient(root);
  const reader = openJsonlClient(root);
  const empty = await writer.snapshot();
  const foreign = { ...node("foreign"), extra: { nested: [1, 2] } };
  const parent = { ...node("parent"), children: ["child"] };
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
  const client = openJsonlClient(workspace());
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
  const root = workspace();
  const client = openJsonlClient(root);
  const empty = await client.snapshot();
  const saved = await client.commit({
    expectedRevision: empty.revision,
    upserts: [node("one", "before")],
    deletes: [],
  });
  const path = join(root, ".kb/nodes.jsonl");
  writeFileSync(path, readFileSync(path, "utf8").replace("before", "after!"));

  expect(
    await codeOf(
      client.commit({ expectedRevision: saved.revision, upserts: [node("two")], deletes: [] }),
    ),
  ).toBe("conflict");
  expect((await client.snapshot()).nodes.map((n) => n.text)).toEqual(["after!"]);
});

test("a malformed upsert rejects the whole batch before anything is stored", async () => {
  const client = openJsonlClient(workspace());
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

test("a malformed query is an invalid_input error", async () => {
  expect(await codeOf(openJsonlClient(workspace()).query("[:find"))).toBe("invalid_input");
});

test("two clients committing from one snapshot: exactly one lands", async () => {
  const root = workspace();
  const first = openJsonlClient(root);
  const second = openJsonlClient(root);
  const before = await first.snapshot();
  const codes = await Promise.all([
    codeOf(
      first.commit({ expectedRevision: before.revision, upserts: [node("first")], deletes: [] }),
    ),
    codeOf(
      second.commit({ expectedRevision: before.revision, upserts: [node("second")], deletes: [] }),
    ),
  ]);
  expect(codes.toSorted()).toEqual(["conflict", "resolved"]);
  expect((await first.snapshot()).nodes).toHaveLength(1);
  expect(new JsonlStore(root).txTail.entries()).toHaveLength(1);
});
