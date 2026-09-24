/**
 * `(reach ?from <edge> ?to [max])` as EDN: parse → IR → compile → rows, on a
 * real DatascriptIndex, through the same `runDatalog` every surface calls.
 */
import { describe, expect, test } from "bun:test";
import type { KbNode, PropValue } from "@kb/model";
import { DatalogError, DatascriptIndex, compile, parseEdn } from "@kb/query";

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
    ["zero bound", "(reach ?a :f/parent ?b 0)", /max must be a positive integer/],
    ["fractional bound", "(reach ?a :f/parent ?b 1.5)", /max must be a positive integer/],
    ["string bound", '(reach ?a :f/parent ?b "3")', /max must be a positive integer/],
    ["constant from", '(reach "p0" :f/parent ?b)', /\?from must be a variable/],
    ["constant to", '(reach ?a :f/parent "p1")', /\?to must be a variable/],
    ["extra argument", "(reach ?a :f/parent ?b 2 3)", /at most 4 arguments/],
  ])("malformed (%s) is a DatalogError naming reach", (_label, clause, message) => {
    const edn = `[:find ?b :where ${clause}]`;
    expect(() => parseEdn(edn)).toThrow(DatalogError);
    expect(() => parseEdn(edn)).toThrow(message);
    expect(() => new DatascriptIndex(lineage(1)).runDatalog(edn)).toThrow(DatalogError);
    expect(() => new DatascriptIndex(lineage(1)).runDatalog(edn)).toThrow(/^reach/);
  });

  // GAP [[01M39X8RPQBWFVDNG77BB3ZCMH]]: outside the subset the whole query is raw, malformed reach too.
  test.each([
    ["a _ wildcard", "[:find ?b :where [_ :node/id ?b] (reach ?a :f/parent ?b 0)]"],
    ["a not clause", '[:find ?b :where (not [?b :node/text "x"]) (reach ?a :f/parent ?b 0)]'],
    ["a :with section", "[:find ?b :where (reach ?a :f/parent ?b 0) :with ?a]"],
  ])("a malformed reach beside %s is raw like the rest of the query", (_label, edn) => {
    expect(parseEdn(edn)).toEqual({ kind: "raw", edn });
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
