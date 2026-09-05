/**
 * The incremental path must be indistinguishable from a rebuild.
 *
 * Every case here is "do it incrementally, then do the same thing from
 * scratch, and demand the same answers" — plus the two places the incremental
 * path is known to be unable to keep that promise (a new attr, a known attr
 * turning into a ref attr), where it must fall back to a rebuild and say so.
 */
import { describe, expect, test } from "bun:test";
import type { KbNode } from "@kb/model";
import { BACKLINKS_IR, DatascriptIndex, type IrQuery } from "@kb/query";

function node(id: string, over: Partial<KbNode> = {}): KbNode {
  return {
    id,
    text: id,
    props: {},
    children: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const TEXT_QUERY = `[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]`;
const MENTIONS_QUERY = `[:find ?from ?to :where [?e :node/mentions ?m] [?e :node/id ?from] [?m :node/id ?to]]`;

function rowOrder(a: string[], b: string[]): number {
  const [x, y] = [a.join(" "), b.join(" ")];
  return x < y ? -1 : x > y ? 1 : 0;
}

function rows(index: DatascriptIndex, edn: string): string[][] {
  return index
    .runDatalog(edn)
    .map((row) => row.map(String))
    .toSorted(rowOrder);
}

/** Same nodes, built from scratch: the answer the incremental path owes. */
function fresh(nodes: KbNode[], edn: string): string[][] {
  return rows(new DatascriptIndex(nodes), edn);
}

describe("DatascriptIndex", () => {
  test("rebuild answers datalog and owns the node lookup", () => {
    const nodes = [node("a", { text: "alpha", children: ["b"] }), node("b", { text: "beta" })];
    const index = new DatascriptIndex(nodes);

    expect(rows(index, TEXT_QUERY)).toEqual([
      ["a", "alpha"],
      ["b", "beta"],
    ]);
    expect(index.getNode("a")?.text).toBe("alpha");
    expect([...index.allNodes()].map((n) => n.id)).toEqual(["a", "b"]);
  });

  test("an edit is incremental and matches a rebuild", () => {
    const before = [node("a", { text: "alpha" }), node("b", { text: "beta" })];
    const index = new DatascriptIndex(before);
    const builds = index.rebuilds;
    const generation = index.generation;

    const edited = node("a", { text: "alpha edited" });
    index.applyTx({ upserts: [edited], deletes: [] });

    expect(index.rebuilds).toBe(builds);
    expect(index.generation).toBe(generation + 1);
    expect(rows(index, TEXT_QUERY)).toEqual(fresh([edited, before[1] as KbNode], TEXT_QUERY));
  });

  test("a delete takes the node and every reference to it", () => {
    const a = node("a", { text: "sees [[b]]", children: ["b"] });
    const b = node("b");
    const index = new DatascriptIndex([a, b]);
    const builds = index.rebuilds;
    expect(rows(index, MENTIONS_QUERY)).toEqual([["a", "b"]]);

    index.applyTx({ upserts: [], deletes: ["b"] });

    expect(index.rebuilds).toBe(builds);
    expect(index.getNode("b")).toBeUndefined();
    expect(rows(index, MENTIONS_QUERY)).toEqual([]);
    expect(rows(index, `[:find ?c :where [?e :node/child ?c]]`)).toEqual([]);
    expect(rows(index, MENTIONS_QUERY)).toEqual(fresh([a], MENTIONS_QUERY));
  });

  test("a reference heals when its target arrives", () => {
    const a = node("a", { text: "sees [[b]]" });
    const index = new DatascriptIndex([a]);
    expect(rows(index, MENTIONS_QUERY)).toEqual([]);
    const builds = index.rebuilds;

    const b = node("b");
    index.applyTx({ upserts: [b], deletes: [] });

    expect(index.rebuilds).toBe(builds);
    expect(rows(index, MENTIONS_QUERY)).toEqual([["a", "b"]]);
    expect(rows(index, MENTIONS_QUERY)).toEqual(fresh([a, b], MENTIONS_QUERY));
  });

  test("eids are never reused, so a revived id is never the wrong node", () => {
    const index = new DatascriptIndex([node("a")]);
    index.applyTx({ upserts: [], deletes: ["a"] });
    index.applyTx({ upserts: [node("c", { text: "sees [[a]]" }), node("a")], deletes: [] });

    expect(rows(index, MENTIONS_QUERY)).toEqual([["c", "a"]]);
  });

  test("a first-seen field attr falls back to one rebuild", () => {
    const a = node("a");
    const index = new DatascriptIndex([a, node("f")]);
    const builds = index.rebuilds;

    const tagged = node("a", { props: { f: [{ t: "str", v: "x" }] } });
    index.applyTx({ upserts: [tagged], deletes: [] });

    expect(index.rebuilds).toBe(builds + 1);
    const query = `[:find ?id ?v :where [?n :node/id ?id] [?n :f/f ?v]]`;
    expect(rows(index, query)).toEqual([["a", "x"]]);
  });

  test("a known attr turning into a ref stays incremental", () => {
    const a = node("a", { props: { f: [{ t: "str", v: "plain" }] } });
    const f = node("f");
    const t = node("t");
    const index = new DatascriptIndex([a, f, t]);
    const builds = index.rebuilds;

    const reffed = node("a", { props: { f: [{ t: "ref", v: "t" }] } });
    index.applyTx({ upserts: [reffed], deletes: [] });

    expect(index.rebuilds).toBe(builds);
    expect(rows(index, MENTIONS_QUERY)).toEqual([["a", "t"]]);
    const query = `[:find ?id :where [?n :node/id "a"] [?n :f/f ?v] [?v :node/id ?id]]`;
    expect(rows(index, query)).toEqual(fresh([reffed, f, t], query));
  });

  test("a dangling prop ref keeps its id as the value, and heals in place", () => {
    const f = node("f");
    const a = node("a", { props: { f: [{ t: "ref", v: "later" }] } });
    const index = new DatascriptIndex([a, f]);
    const query = `[:find ?v :where [?n :node/id "a"] [?n :f/f ?v]]`;
    expect(rows(index, query)).toEqual([["later"]]);

    const builds = index.rebuilds;
    const later = node("later");
    index.applyTx({ upserts: [later], deletes: [] });

    expect(index.rebuilds).toBe(builds);
    expect(rows(index, query)).toEqual([["later"]]);
    expect(rows(index, MENTIONS_QUERY)).toEqual([["a", "later"]]);
    expect(rows(index, query)).toEqual(fresh([a, f, later], query));
  });

  test("a multi-valued prop keeps every value across an incremental edit", () => {
    const f = node("f");
    const a = node("a", { props: { f: [{ t: "str", v: "one" }] } });
    const index = new DatascriptIndex([a, f]);
    const builds = index.rebuilds;

    const both = node("a", {
      props: {
        f: [
          { t: "str", v: "one" },
          { t: "str", v: "two" },
        ],
      },
    });
    index.applyTx({ upserts: [both], deletes: [] });

    expect(index.rebuilds).toBe(builds);
    const query = `[:find ?v :where [?n :node/id "a"] [?n :f/f ?v]]`;
    expect(rows(index, query)).toEqual([["one"], ["two"]]);
    expect(rows(index, query)).toEqual(fresh([both, f], query));
  });

  test("child order survives an incremental reparent", () => {
    const nodes = [node("p", { children: ["a", "b"] }), node("a"), node("b")];
    const index = new DatascriptIndex(nodes);
    const builds = index.rebuilds;

    const reordered = node("p", { children: ["b", "a"] });
    index.applyTx({ upserts: [reordered], deletes: [] });

    expect(index.rebuilds).toBe(builds);
    // Order lives on the `:node/children` vector — joining `:node/child` with
    // `:node/child-order` is the cartesian the compiler rewrites away.
    const query = `[:find ?v :where [?p :node/id "p"] [?p :node/children ?v]]`;
    expect(rows(index, query)).toEqual([["b,a"]]);
    expect(rows(index, query)).toEqual(
      fresh([reordered, nodes[1] as KbNode, nodes[2] as KbNode], query),
    );
  });

  test("search scans text case-insensitively, sorted by id, and honours a limit", () => {
    const index = new DatascriptIndex([
      node("b", { text: "Drift audit" }),
      node("a", { text: "drift marker" }),
      node("c", { text: "unrelated" }),
    ]);

    expect(index.search("DRIFT").map((n) => n.id)).toEqual(["a", "b"]);
    expect(index.search("drift", 1).map((n) => n.id)).toEqual(["a"]);
    expect(index.search("nothing")).toEqual([]);
  });

  test("virtual nodes answer queries and stay out of the stored projection", () => {
    const stored = node("a");
    const index = new DatascriptIndex([stored]);
    index.withVirtual([node("sys.query.v", { text: "saved" })]);

    expect(rows(index, TEXT_QUERY)).toEqual([
      ["a", "a"],
      ["sys.query.v", "saved"],
    ]);
    expect(index.storedNodes().map((n) => n.id)).toEqual(["a"]);
    expect(index.getNode("sys.query.v")?.text).toBe("saved");
  });

  test("a virtual node the store later owns stops being virtual", () => {
    const index = new DatascriptIndex([node("a")]);
    index.withVirtual([node("sys.query.v", { text: "saved" })]);

    const real = node("sys.query.v", { text: "persisted" });
    index.applyTx({ upserts: [real], deletes: [] });
    expect(index.storedNodes().map((n) => n.id)).toEqual(["a", "sys.query.v"]);

    // …and once the store drops it, it is gone rather than resurrected.
    index.applyTx({ upserts: [], deletes: ["sys.query.v"] });
    expect(index.getNode("sys.query.v")).toBeUndefined();
    expect(index.storedNodes().map((n) => n.id)).toEqual(["a"]);
  });

  test("rebuild keeps the virtual set and the stored order the store gave", () => {
    const index = new DatascriptIndex([node("b"), node("a")]);
    index.withVirtual([node("sys.query.v")]);
    index.rebuild([node("b"), node("a"), node("c")]);

    expect(index.storedNodes().map((n) => n.id)).toEqual(["b", "a", "c"]);
    expect(index.getNode("sys.query.v")).toBeDefined();
  });

  test("pull revives node ids", () => {
    const index = new DatascriptIndex([node("p", { children: ["c"] }), node("c")]);
    const pulled = index.pull(`[:node/id :node/text {:node/child [:node/id]}]`, "p") as Record<
      string,
      unknown
    >;
    expect(pulled[":node/id"]).toBe("p");
  });

  test("run keeps aggregate numbers typed and binds backlinks ids as inputs", () => {
    const targetId = 'target"quoted';
    const index = new DatascriptIndex([
      node("a", { text: `sees [[${targetId}]]`, props: { status: [{ t: "str", v: "doing" }] } }),
      node("b", { props: { status: [{ t: "str", v: "doing" }] } }),
      node("c", { props: { status: [{ t: "str", v: "doing" }] } }),
      node(targetId, { text: "target" }),
    ]);
    const count: IrQuery = {
      kind: "query",
      find: [
        { kind: "var", name: "v", type: "scalar" },
        { kind: "aggregate", op: "count", of: "n", type: "aggregate" },
      ],
      where: [{ kind: "pattern", entity: "n", attr: ":f/status", value: { t: "var", name: "v" } }],
    };

    expect(index.runDatalog("[:find ?v (count ?n) :where [?n :f/status ?v]]")).toEqual([
      ["doing", "c"],
    ]);
    expect(index.run(count)).toEqual([["doing", 3]]);
    expect(index.run(BACKLINKS_IR, targetId)).toEqual([["a", `sees [[${targetId}]]`]]);
  });
});
