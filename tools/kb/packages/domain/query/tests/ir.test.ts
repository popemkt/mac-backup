/**
 * Query IR: parse/compile round-trip on stored shapes, typed revival, reach.
 */
import {
  LIST_ALL_NODES_QUERY,
  LIST_FIELDS_QUERY,
  LIST_TAGS_QUERY,
  backlinksQuery,
  buildQueryDb,
  compile,
  datascriptExecutor,
  parseEdn,
  query,
  runIr,
  type IrQuery,
} from "@kb/query";
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { systemSeedNodes, type KbNode } from "@kb/model";

const AT = "2026-01-01T00:00:00.000Z";

function node(id: string, extra: Partial<KbNode> = {}): KbNode {
  return {
    id,
    text: extra.text ?? id,
    props: extra.props ?? {},
    children: extra.children ?? [],
    createdAt: extra.createdAt ?? AT,
    updatedAt: extra.updatedAt ?? AT,
  };
}

function sortedRows(raw: unknown): unknown[][] {
  if (!Array.isArray(raw)) return [];
  const rows = raw.filter((r): r is unknown[] => Array.isArray(r));
  return [...rows].toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function sameRows(a: unknown, b: unknown): void {
  expect(sortedRows(a)).toEqual(sortedRows(b));
}

/** Stored-query shapes enumerated for the migration wave. */
const STORED_QUERIES: { name: string; edn: string }[] = [
  {
    name: "sys.f.query All todos live",
    edn: '[:find ?id ?text :where [?n :f/sys.f.type ?t] [?t :node/text "todo"] [?n :node/id ?id] [?n :node/text ?text]]',
  },
  {
    name: ".kb/queries/todos.edn",
    edn: `[:find ?id ?text
 :where
 [?n :f/sys.f.type ?tag]
 [?tag :node/text "todo"]
 [?tag :f/sys.f.type ?tagType]
 [?tagType :node/id "sys.tag"]
 [?n :node/id ?id]
 [?n :node/text ?text]]`,
  },
  {
    name: ".kb/views/todos.json",
    edn: '[:find ?id :where [?n :f/sys.f.type ?tag] [?tag :node/text "todo"] [?tag :f/sys.f.type ?tagType] [?tagType :node/id "sys.tag"] [?n :node/id ?id]]',
  },
  {
    name: ".kb/views/rules.json",
    edn: '[:find ?id :where [?n :f/sys.f.type ?tag] [?tag :node/text "rule"] [?tag :f/sys.f.type ?tagType] [?tagType :node/id "sys.tag"] [?n :node/id ?id]]',
  },
  {
    name: "sys.f.targetQuery onto.extends",
    edn: '[:find ?id :where [?n :f/sys.f.type ?t] [?t :node/id "sys.tag.ontology"] [?n :node/id ?id]]',
  },
  { name: "LIST_FIELDS_QUERY", edn: LIST_FIELDS_QUERY },
  { name: "LIST_TAGS_QUERY", edn: LIST_TAGS_QUERY },
  { name: "LIST_ALL_NODES_QUERY", edn: LIST_ALL_NODES_QUERY },
  { name: "backlinksQuery(sys.tag)", edn: backlinksQuery("sys.tag") },
];

const VIEW_FILTER = '{:field sys.f.type :eq "todo"}';

describe("parseEdn subset vs raw", () => {
  test("every stored datalog query parses as structured IR", () => {
    for (const q of STORED_QUERIES) {
      const ir = parseEdn(q.edn);
      expect(ir.kind).toBe("query");
    }
  });

  test("sys.f.view.filter maps are raw (not datalog)", () => {
    expect(parseEdn(VIEW_FILTER)).toEqual({ kind: "raw", edn: VIEW_FILTER });
  });

  test("malformed EDN is raw, not a throw", () => {
    expect(parseEdn("[:find ?x :where").kind).toBe("raw");
  });
});

describe("compile(parse(edn)) is query-equivalent", () => {
  const db = buildQueryDb([
    ...systemSeedNodes(AT),
    node("n.todo", {
      text: "a todo",
      props: { "sys.f.type": [{ t: "ref", v: "sys.tag" }] },
    }),
  ]);

  test("stored queries: same rows as the original EDN", () => {
    for (const q of STORED_QUERIES) {
      const compiled = compile(parseEdn(q.edn));
      sameRows(query(db, compiled.query), query(db, q.edn));
    }
  });

  test("generated corpus: pattern queries round-trip by rows", () => {
    const corpus = [
      "[:find ?id :where [?n :node/id ?id]]",
      "[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]",
      '[:find ?id :where [?n :node/id ?id] [?n :node/text "a todo"]]',
      "[:find ?id :where [?n :f/sys.f.type ?t] [?t :node/id ?tid] [?n :node/id ?id]]",
    ];
    fc.assert(
      fc.property(fc.constantFrom(...corpus), (edn) => {
        const compiled = compile(parseEdn(edn));
        expect(sortedRows(query(db, compiled.query))).toEqual(sortedRows(query(db, edn)));
      }),
      { numRuns: 20 },
    );
  });
});

describe("runIr revives only node-ref positions", () => {
  const db = buildQueryDb([
    node("a", { props: { "fld.status": [{ t: "str", v: "doing" }] } }),
    node("b", { props: { "fld.status": [{ t: "str", v: "doing" }] } }),
    node("c", { props: { "fld.status": [{ t: "str", v: "doing" }] } }),
  ]);
  const edn = "[:find ?v (count ?n) :where [?n :f/fld.status ?v]]";

  test("count-revival: query() collides with an eid; runIr keeps the count", () => {
    const raw = query(db, edn);
    const ir = parseEdn(edn);
    expect(ir.kind).toBe("query");
    const typed = runIr(datascriptExecutor(db), ir, db.ids);
    expect(sortedRows(raw)).toEqual([["doing", "c"]]);
    expect(sortedRows(typed)).toEqual([["doing", 3]]);
  });
});

describe("reach compiles to a recursive DataScript rule", () => {
  const db = buildQueryDb([
    node("a", { text: "[[b]]" }),
    node("b", { text: "[[c]]" }),
    node("c", { text: "leaf" }),
  ]);

  test("constructed reach IR returns the closure", () => {
    const ir: IrQuery = {
      kind: "query",
      find: [{ kind: "var", name: "id", type: "node-ref" }],
      where: [
        { kind: "pattern", entity: "root", attr: ":node/id", value: { t: "str", value: "a" } },
        { kind: "reach", from: "root", to: "n", edge: ":node/mentions" },
        { kind: "pattern", entity: "n", attr: ":node/id", value: { t: "var", name: "id" } },
      ],
    };
    const compiled = compile(ir);
    expect(compiled.rules).toContain("reach");
    const rows = runIr(datascriptExecutor(db), ir, db.ids);
    expect(
      sortedRows(rows)
        .map((r) => r[0])
        .toSorted((x, y) => String(x).localeCompare(String(y))),
    ).toEqual(["b", "c"]);
  });
});

describe("children clause replaces the cartesian join", () => {
  const db = buildQueryDb([
    node("p", { children: ["c1", "c2", "c3"] }),
    node("c1"),
    node("c2"),
    node("c3"),
  ]);
  const cartesian = `[:find ?cId ?ord :where [?p :node/id "p"] [?p :node/child ?c] [?p :node/child-order ?ord] [?c :node/id ?cId]]`;

  test("parse collapses child+child-order to children; compile returns N rows", () => {
    const ir = parseEdn(cartesian);
    expect(ir.kind).toBe("query");
    if (ir.kind !== "query") return;
    expect(ir.where.some((c) => c.kind === "children")).toBe(true);
    const rows = runIr(datascriptExecutor(db), ir, db.ids);
    expect(sortedRows(rows)).toHaveLength(3);
  });
});
