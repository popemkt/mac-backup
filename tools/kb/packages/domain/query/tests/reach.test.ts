/**
 * `(reach ?from <edge> ?to [max])` as EDN: parse → IR → compile → rows, on a
 * real DatascriptIndex, through the same `runDatalog` every surface calls.
 */
import { describe, expect, test } from "bun:test";
import type { KbNode, PropValue } from "@kb/model";
import { DatascriptIndex, compile, parseEdn } from "@kb/query";

const AT = "2026-01-01T00:00:00.000Z";

function node(id: string, over: Partial<KbNode> = {}): KbNode {
  return { id, text: id, props: {}, children: [], createdAt: AT, updatedAt: AT, ...over };
}

function ref(v: string): PropValue {
  return { t: "ref", v };
}

/** `p0 -parent-> p1 -parent-> … -parent-> p<n>`: a lineage over a ref field. */
function lineage(n: number): KbNode[] {
  return Array.from({ length: n + 1 }, (_, i) =>
    node(`p${i}`, i < n ? { props: { parent: [ref(`p${i + 1}`)] } } : {}),
  );
}

function firstColumn(rows: unknown[][]): string[] {
  return rows.map((r) => String(r[0])).toSorted();
}

const ANCESTORS = (root: string, max = "") =>
  `[:find ?id :where [?me :node/id "${root}"] (reach ?me :f/parent ?a${max}) [?a :node/id ?id]]`;

describe("parseEdn reads the reach form", () => {
  test("unbounded", () => {
    const ir = parseEdn(`[:find ?b :where (reach ?a :node/mentions ?b)]`);
    expect(ir).toEqual({
      kind: "query",
      find: [{ kind: "var", name: "b", type: "node-ref" }],
      where: [{ kind: "reach", from: "a", to: "b", edge: ":node/mentions" }],
    });
  });

  test("bounded", () => {
    const ir = parseEdn(`[:find ?b :where (reach ?a :f/parent ?b 3)]`);
    expect(ir.kind === "query" && ir.where[0]).toEqual({
      kind: "reach",
      from: "a",
      to: "b",
      edge: ":f/parent",
      maxHops: 3,
    });
  });

  test("the compiled query calls the rule it emits and declares %", () => {
    const compiled = compile(parseEdn(`[:find ?b :where (reach ?a :node/child ?b)]`));
    expect(compiled.query).toContain(":in $ %");
    expect(compiled.query).toContain("(__kb_reach_0 ?a ?b)");
    expect(compiled.rules).toContain("__kb_reach_0");
  });

  test("a rule call named reach without an edge keyword stays a rule call", () => {
    const ir = parseEdn(`[:find ?b :in $ % :where (reach ?a ?b)]`);
    expect(ir.kind === "query" && ir.where[0]?.kind).toBe("rule");
  });

  test.each([
    ["zero bound", "(reach ?a :f/parent ?b 0)"],
    ["fractional bound", "(reach ?a :f/parent ?b 1.5)"],
    ["constant end", '(reach "p0" :f/parent ?b)'],
    ["extra argument", "(reach ?a :f/parent ?b 2 3)"],
  ])("malformed (%s) is not a reach clause", (_label, clause) => {
    expect(parseEdn(`[:find ?b :where ${clause}]`).kind).toBe("raw");
  });
});

describe("reach over a ref field", () => {
  test("a 50-hop lineage is traced to the end — no cap", () => {
    const index = new DatascriptIndex(lineage(50));
    const rows = index.runDatalog(ANCESTORS("p0"));
    expect(rows).toHaveLength(50);
    expect(firstColumn(rows)).toContain("p50");
    expect(firstColumn(rows)).not.toContain("p0");
  });

  test("a bound caps the hop count", () => {
    const index = new DatascriptIndex(lineage(50));
    expect(firstColumn(index.runDatalog(ANCESTORS("p0", " 3")))).toEqual(["p1", "p2", "p3"]);
    expect(firstColumn(index.runDatalog(ANCESTORS("p0", " 1")))).toEqual(["p1"]);
  });

  test("the bound end may be the target: descendants walk the edge backwards", () => {
    const index = new DatascriptIndex(lineage(5));
    const rows = index.runDatalog(
      `[:find ?id :where [?anc :node/id "p3"] (reach ?d :f/parent ?anc) [?d :node/id ?id]]`,
    );
    expect(firstColumn(rows)).toEqual(["p0", "p1", "p2"]);
  });

  test("a cycle terminates, unbounded and bounded", () => {
    const index = new DatascriptIndex([
      node("x", { props: { parent: [ref("y")] } }),
      node("y", { props: { parent: [ref("z")] } }),
      node("z", { props: { parent: [ref("x")] } }),
    ]);
    expect(firstColumn(index.runDatalog(ANCESTORS("x")))).toEqual(["x", "y", "z"]);
    expect(firstColumn(index.runDatalog(ANCESTORS("x", " 2")))).toEqual(["y", "z"]);
    expect(firstColumn(index.runDatalog(ANCESTORS("x", " 30")))).toEqual(["x", "y", "z"]);
  });

  test.each([
    ["a bool", { t: "bool", v: false }],
    ["a number that is no eid", { t: "num", v: 99 }],
    ["a string", { t: "str", v: "p1" }],
  ] as [string, PropValue][])(
    "%s on the edge is neither followed nor returned",
    (_label, value) => {
      const index = new DatascriptIndex([
        node("p0", { props: { parent: [value, ref("p1")] } }),
        node("p1", { props: { parent: [value] } }),
      ]);
      expect(firstColumn(index.runDatalog(ANCESTORS("p0")))).toEqual(["p1"]);
      expect(firstColumn(index.runDatalog(ANCESTORS("p0", " 4")))).toEqual(["p1"]);
      const bare = `[:find ?a :where [?me :node/id "p1"] (reach ?me :f/parent ?a)]`;
      expect(index.runDatalog(bare)).toEqual([]);
    },
  );

  // GAP [[01M3A0Y5JQ5XKZMC87K34HDT2B]]: pins today's aliasing; flips to [] when refs and numbers are encoded apart.
  test("a number equal to a live eid still aliases that node", () => {
    const index = new DatascriptIndex([
      node("p0", { props: { parent: [{ t: "num", v: 2 }] } }),
      node("p1"),
    ]);
    expect(firstColumn(index.runDatalog(ANCESTORS("p0")))).toEqual(["p1"]);
  });

  test("a dangling ref on the lineage is skipped", () => {
    const index = new DatascriptIndex([
      node("p0", { props: { parent: [ref("p1")] } }),
      node("p1", { props: { parent: [ref("deleted")] } }),
    ]);
    expect(firstColumn(index.runDatalog(ANCESTORS("p0")))).toEqual(["p1"]);
  });
});

describe("reach over the structural edges", () => {
  const index = new DatascriptIndex([
    node("a", { text: "see [[b]]", children: ["a1"] }),
    node("a1", { children: ["a2"] }),
    node("a2"),
    node("b", { props: { rel: [ref("c")] } }),
    node("c"),
  ]);

  test(":node/mentions follows both carriers — text and ref props", () => {
    const rows = index.runDatalog(
      `[:find ?id :where [?r :node/id "a"] (reach ?r :node/mentions ?n) [?n :node/id ?id]]`,
    );
    expect(firstColumn(rows)).toEqual(["b", "c"]);
  });

  test(":node/child is the descendant closure", () => {
    const rows = index.runDatalog(
      `[:find ?id :where [?r :node/id "a"] (reach ?r :node/child ?n) [?n :node/id ?id]]`,
    );
    expect(firstColumn(rows)).toEqual(["a1", "a2"]);
  });

  test("two reach clauses in one query get their own rules", () => {
    const rows = index.runDatalog(
      `[:find ?cid ?mid :where [?r :node/id "a"] (reach ?r :node/child ?c) (reach ?r :node/mentions ?m 1) [?c :node/id ?cid] [?m :node/id ?mid]]`,
    );
    expect(rows.map((r) => r.join(" ")).toSorted()).toEqual(["a1 b", "a2 b"]);
  });

  test("a caller's own % rules combine with reach", () => {
    const rows = index.runDatalog(
      `[:find ?id :in $ % :where [?r :node/id "a"] (reach ?r :node/mentions ?n) (leaf ?n) [?n :node/id ?id]]`,
      `[[(leaf ?n) [?n :node/text "c"]]]`,
    );
    expect(firstColumn(rows)).toEqual(["c"]);
  });
});
