/**
 * W4 — query nodes as pure system nodes (DESIGN-REFINE §2 W4).
 * Seed: sys.tag.query templating sys.f.query / sys.f.query.limit.
 * Saved queries: .kb/queries/*.edn materialize as sys.query.* nodes under
 * sys.queries in the UI graph only — never duplicated into nodes.jsonl.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSystemSeed, present, SYSTEM_IDS, systemSeedNodes, type KbNode } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { savedQueryNodes } from "../src/saved-queries.ts";
import { startUi, type UiServerHandle } from "../src/server.ts";

function refs(node: KbNode | WireNode, field: string): string[] {
  return (node.props[field] ?? []).filter((v) => v.t === "ref").map((v) => v.v);
}

describe("W4 seed: query tag + fields", () => {
  test("seeds sys.tag.query templating sys.f.query and sys.f.query.limit", () => {
    const seed = systemSeedNodes();
    const byId = new Map(seed.map((n) => [n.id, n]));

    const tag = byId.get(SYSTEM_IDS.queryTag);
    expect(tag).toBeDefined();
    expect(present(tag, "expected tag").text).toBe("query");
    expect(refs(present(tag, "expected tag"), SYSTEM_IDS.typeField)).toEqual([SYSTEM_IDS.tag]);
    expect(refs(present(tag, "expected tag"), SYSTEM_IDS.fieldsField)).toEqual([
      SYSTEM_IDS.queryField,
      SYSTEM_IDS.queryLimitField,
    ]);

    for (const id of [SYSTEM_IDS.queryField, SYSTEM_IDS.queryLimitField]) {
      const field = byId.get(id);
      expect(field).toBeDefined();
      expect(refs(present(field, "expected field"), SYSTEM_IDS.typeField)).toEqual([
        SYSTEM_IDS.field,
      ]);
    }

    // sys.queries is virtual (ui-server materialized) — never seeded.
    expect(byId.has(SYSTEM_IDS.queriesRoot)).toBe(false);
  });

  test("ensureSystemSeed is idempotent over the W4 nodes", () => {
    const first = ensureSystemSeed([]);
    expect(first.seeded).toBe(true);
    const again = ensureSystemSeed(first.nodes);
    expect(again.seeded).toBe(false);
    expect(again.nodes.length).toBe(first.nodes.length);
  });
});

describe("W4 savedQueryNodes", () => {
  test("builds a sys.queries root with tagged query children", () => {
    const nodes = savedQueryNodes([
      { name: "open-todos", edn: "[:find ?id :where [?e :node/id ?id]]\n" },
    ]);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const root = byId.get(SYSTEM_IDS.queriesRoot);
    expect(root).toBeDefined();
    expect(present(root, "expected root").children).toEqual(["sys.query.open-todos"]);

    const q = byId.get("sys.query.open-todos");
    expect(q).toBeDefined();
    expect(present(q, "expected q").text).toBe("open-todos");
    expect(refs(present(q, "expected q"), SYSTEM_IDS.typeField)).toEqual([SYSTEM_IDS.queryTag]);
    expect(present(q, "expected q").props[SYSTEM_IDS.queryField]).toEqual([
      { t: "str", v: "[:find ?id :where [?e :node/id ?id]]" },
    ]);
  });

  test("empty saved list materializes nothing", () => {
    expect(savedQueryNodes([])).toEqual([]);
  });
});

describe("W4 saved-query surfacing via kb ui server", () => {
  let root: string;
  let handle: UiServerHandle | null = null;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-w4-"));
    await mkdir(join(root, ".kb", "queries"), { recursive: true });
  });

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = null;
    }
    await rm(root, { recursive: true, force: true });
  });

  test("surfaces .kb/queries/*.edn as query nodes, not in jsonl", async () => {
    const edn = "[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]";
    await writeFile(join(root, ".kb", "queries", "all-nodes.edn"), edn + "\n");

    handle = await startUi({ root, port: 0, openBrowser: false });

    const res = await fetch(`${handle.url}/api/graph`);
    expect(res.status).toBe(200);
    const snap = (await res.json()) as { rev: number; nodes: WireNode[] };
    const byId = new Map(snap.nodes.map((n) => [n.id, n]));

    const queriesRoot = byId.get(SYSTEM_IDS.queriesRoot);
    expect(queriesRoot).toBeDefined();
    expect(present(queriesRoot, "expected queriesRoot").children).toEqual(["sys.query.all-nodes"]);

    const q = byId.get("sys.query.all-nodes");
    expect(q).toBeDefined();
    expect(refs(present(q, "expected q"), SYSTEM_IDS.typeField)).toEqual([SYSTEM_IDS.queryTag]);
    expect(present(q, "expected q").props[SYSTEM_IDS.queryField]).toEqual([{ t: "str", v: edn }]);

    // Materialized at load only — never duplicated into nodes.jsonl.
    const jsonl = await readFile(join(root, ".kb", "nodes.jsonl"), "utf8");
    expect(jsonl).not.toContain("sys.query.");
    expect(jsonl).not.toContain(`"${SYSTEM_IDS.queriesRoot}"`);

    // Virtual nodes survive an action round-trip (rev bump, still present).
    const actionResp = await fetch(`${handle.url}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "node.add",
        input: { text: "real node", id: "test-real" },
      }),
    });
    expect(actionResp.status).toBe(200);
    const after = (await (await fetch(`${handle.url}/api/graph`)).json()) as {
      rev: number;
      nodes: WireNode[];
    };
    expect(after.rev).toBeGreaterThan(snap.rev);
    const afterIds = new Set(after.nodes.map((n) => n.id));
    expect(afterIds.has("sys.query.all-nodes")).toBe(true);
    expect(afterIds.has("test-real")).toBe(true);

    // sys.* write-guard: materialized query nodes are read-only.
    const guard = await fetch(`${handle.url}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "node.update",
        input: { id: "sys.query.all-nodes", text: "nope" },
      }),
    });
    const receipt = (await guard.json()) as { status: string };
    expect(receipt.status).toBe("failed");

    const jsonlAfter = await readFile(join(root, ".kb", "nodes.jsonl"), "utf8");
    expect(jsonlAfter).not.toContain("sys.query.");

    // Live subscription sees materialized query nodes through ctx.qdb.
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("ws open failed")));
    });
    const rows = await new Promise<unknown[][]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout waiting for rows")), 3000);
      ws.addEventListener("message", (ev) => {
        const msg = JSON.parse(String(ev.data)) as {
          op: string;
          id?: string;
          rows?: unknown[][];
        };
        if (msg.op === "rows" && msg.id === "w4") {
          clearTimeout(timer);
          resolve(msg.rows ?? []);
        }
      });
      ws.send(
        JSON.stringify({
          op: "subscribe",
          id: "w4",
          query: '[:find ?id :where [?n :node/id ?id] [?n :node/text "all-nodes"]]',
        }),
      );
    });
    expect(rows.flat()).toContain("sys.query.all-nodes");
    ws.close();
  });
});
