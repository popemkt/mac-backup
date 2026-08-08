import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlStore, canonicalJson } from "../src/foundation/storage/index.ts";
import { openKb } from "../src/context.ts";
import { SYSTEM_IDS, type KbNode } from "../src/foundation/model.ts";
import { ensureSystemSeed, systemSeedNodes } from "../src/foundation/seed.ts";
import { invoke, manifest } from "../src/registry.ts";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kb-test-"));
}

describe("JsonlStore", () => {
  let root: string;
  beforeEach(async () => {
    root = await tempRoot();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("round-trip is byte-stable", async () => {
    const store = new JsonlStore(root);
    const at = "2026-01-01T00:00:00.000Z";
    const nodes: KbNode[] = [
      {
        id: "01HZZZZZZZZZZZZZZZZZZZZZZ1",
        text: "b",
        props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
        children: ["01HZZZZZZZZZZZZZZZZZZZZZZ2"],
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "01HZZZZZZZZZZZZZZZZZZZZZZ2",
        text: "a",
        props: {},
        children: [],
        createdAt: at,
        updatedAt: at,
      },
    ];
    await store.commit({ upserts: nodes, deletes: [] });
    const first = await readFile(join(root, ".kb", "nodes.jsonl"), "utf8");
    const loaded = await store.load();
    await store.commit({ upserts: loaded, deletes: [] });
    const second = await readFile(join(root, ".kb", "nodes.jsonl"), "utf8");
    expect(second).toBe(first);
    // sorted by id, canonical keys
    const lines = first.trim().split("\n");
    expect(lines[0]!.startsWith('{"children"')).toBe(true);
    expect(JSON.parse(lines[0]!).id < JSON.parse(lines[1]!).id).toBe(true);
    expect(lines[0]).toBe(canonicalJson(JSON.parse(lines[0]!)));
  });
});

describe("system seed", () => {
  let root: string;
  beforeEach(async () => {
    root = await tempRoot();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("created on first init and idempotent", async () => {
    const ctx1 = await openKb(root);
    const ids = new Set(ctx1.nodes.map((n) => n.id));
    for (const s of systemSeedNodes()) {
      expect(ids.has(s.id)).toBe(true);
    }
    const bytes1 = await readFile(join(root, ".kb", "nodes.jsonl"), "utf8");

    const ctx2 = await openKb(root);
    expect(ctx2.nodes.length).toBe(ctx1.nodes.length);
    const bytes2 = await readFile(join(root, ".kb", "nodes.jsonl"), "utf8");
    expect(bytes2).toBe(bytes1);

    const again = ensureSystemSeed(ctx2.nodes);
    expect(again.seeded).toBe(false);
  });
});

describe("registry + operations", () => {
  let root: string;
  beforeEach(async () => {
    root = await tempRoot();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("manifest exposes JSON schemas", () => {
    const m = manifest();
    expect(m.some((a) => a.id === "node.add")).toBe(true);
    const add = m.find((a) => a.id === "graph.query")!;
    expect(add.inputSchema).toBeTruthy();
    expect(add.mode).toBe("read");
  });

  test("invoke happy path: field, tag, node, query refs", async () => {
    const ctx = await openKb(root);

    const field = await invoke(ctx, {
      id: "field.define",
      input: { name: "status" },
    });
    expect(field.status).toBe("succeeded");
    if (field.status !== "succeeded") return;
    const statusId = (field.output as { id: string }).id;

    const tag = await invoke(ctx, {
      id: "tag.define",
      input: { name: "todo", fields: ["status"] },
    });
    expect(tag.status).toBe("succeeded");
    if (tag.status !== "succeeded") return;
    const todoId = (tag.output as { id: string }).id;

    const added = await invoke(ctx, {
      id: "node.add",
      input: {
        text: "Ship M1 [[sys.tag|tag]]",
        tags: ["todo"],
        props: [
          { field: "status", value: { t: "str", v: "doing" } },
        ],
      },
    });
    expect(added.status).toBe("succeeded");
    if (added.status !== "succeeded") return;
    const nodeId = (added.output as { id: string }).id;

    const got = await invoke(ctx, {
      id: "node.get",
      input: { id: nodeId, depth: 0 },
    });
    expect(got.status).toBe("succeeded");

    // datalog join over type ref
    const q = await invoke(ctx, {
      id: "graph.query",
      input: {
        query: `[:find ?id ?tag
                 :where [?n :node/id ?id]
                        [?n :f/${SYSTEM_IDS.typeField} ?t]
                        [?t :node/id ?tag]]`,
      },
    });
    expect(q.status).toBe("succeeded");
    if (q.status !== "succeeded") return;
    const rows = (q.output as { rows: unknown[][] }).rows;
    expect(rows.some((r) => r[0] === nodeId && r[1] === todoId)).toBe(true);

    // mentions extracted
    const mq = await invoke(ctx, {
      id: "graph.query",
      input: {
        query: `[:find ?from ?to
                 :where [?e :node/mentions ?m]
                        [?e :node/id ?from]
                        [?m :node/id ?to]]`,
      },
    });
    expect(mq.status).toBe("succeeded");
    if (mq.status !== "succeeded") return;
    const mrows = (mq.output as { rows: unknown[][] }).rows;
    expect(mrows.some((r) => r[0] === nodeId && r[1] === SYSTEM_IDS.tag)).toBe(
      true,
    );

    // status field prop
    const sq = await invoke(ctx, {
      id: "graph.query",
      input: {
        query: `[:find ?id ?v
                 :where [?n :node/id ?id]
                        [?n :f/${statusId} ?v]]`,
      },
    });
    expect(sq.status).toBe("succeeded");
    if (sq.status !== "succeeded") return;
    expect(
      (sq.output as { rows: unknown[][] }).rows.some(
        (r) => r[0] === nodeId && r[1] === "doing",
      ),
    ).toBe(true);
  });

  test("invoke failure: unknown action and ambiguous field", async () => {
    const ctx = await openKb(root);
    const unknown = await invoke(ctx, { id: "nope", input: {} });
    expect(unknown.status).toBe("failed");
    if (unknown.status === "failed") {
      expect(unknown.code).toBe("unknown_action");
    }

    await invoke(ctx, { id: "field.define", input: { name: "dup" } });
    await invoke(ctx, {
      id: "field.define",
      input: { name: "dup", id: "01CUSTOMFIELD0000000000001" },
    });
    // two fields named dup → resolve by name is ambiguous
    const bad = await invoke(ctx, {
      id: "node.add",
      input: {
        text: "x",
        props: [{ field: "dup", value: { t: "str", v: "y" } }],
      },
    });
    expect(bad.status).toBe("failed");
    if (bad.status === "failed") {
      expect(bad.code).toBe("ambiguous");
    }

    // never throws
    expect(async () => {
      await invoke(ctx, { id: "node.get", input: { id: "missing" } });
    }).not.toThrow();
  });

  test("node.update rejects moves into own subtree", async () => {
    const ctx = await openKb(root);
    const a = await invoke(ctx, { id: "node.add", input: { text: "a" } });
    const aId = (a as { output: { id: string } }).output.id;
    const b = await invoke(ctx, {
      id: "node.add",
      input: { text: "b", parent: aId },
    });
    const bId = (b as { output: { id: string } }).output.id;
    const c = await invoke(ctx, {
      id: "node.add",
      input: { text: "c", parent: bId },
    });
    const cId = (c as { output: { id: string } }).output.id;

    const selfMove = await invoke(ctx, {
      id: "node.update",
      input: { id: aId, parent: aId },
    });
    expect(selfMove.status).toBe("failed");

    const cycleMove = await invoke(ctx, {
      id: "node.update",
      input: { id: aId, parent: cId },
    });
    expect(cycleMove.status).toBe("failed");
    if (cycleMove.status === "failed") {
      expect(cycleMove.code).toBe("invalid_move");
    }

    // legal reparent still works
    const ok = await invoke(ctx, {
      id: "node.update",
      input: { id: cId, parent: aId },
    });
    expect(ok.status).toBe("succeeded");
  });

  test("graph.query keeps colons inside string literals intact", async () => {
    const ctx = await openKb(root);
    await invoke(ctx, { id: "node.add", input: { text: "Type:Draft" } });
    const q = await invoke(ctx, {
      id: "graph.query",
      input: {
        query: '[:find ?e :where [?e :node/text "Type:Draft"]]',
      },
    });
    expect(q.status).toBe("succeeded");
    if (q.status === "succeeded") {
      expect((q.output as { rows: unknown[][] }).rows.length).toBe(1);
    }
  });

  test("sys.* write-guard blocks edits unless force", async () => {
    const ctx = await openKb(root);
    const blocked = await invoke(ctx, {
      id: "node.update",
      input: { id: SYSTEM_IDS.tag, text: "hacked" },
    });
    expect(blocked.status).toBe("failed");
    if (blocked.status === "failed") {
      expect(blocked.code).toBe("forbidden");
    }
    expect(ctx.nodes.find((n) => n.id === SYSTEM_IDS.tag)?.text).toBe(
      "sys.tag",
    );

    const forced = await invoke(ctx, {
      id: "node.update",
      input: { id: SYSTEM_IDS.tag, text: "sys.tag", force: true },
    });
    expect(forced.status).toBe("succeeded");

    // Browse (node.get) still works
    const got = await invoke(ctx, {
      id: "node.get",
      input: { id: SYSTEM_IDS.command, depth: 0 },
    });
    expect(got.status).toBe("succeeded");

    // Seeded command nodes exist
    expect(ctx.nodes.some((n) => n.id === SYSTEM_IDS.cmdAddNode)).toBe(true);
  });
});
