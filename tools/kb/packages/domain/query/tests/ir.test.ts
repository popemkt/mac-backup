/**
 * Query IR: parse/compile round-trip on stored shapes, typed revival, reach.
 */
import {
  LIST_ALL_NODES_QUERY,
  LIST_FIELDS_QUERY,
  LIST_TAGS_QUERY,
  backlinksQuery,
  DatascriptIndex,
  compile,
  parseEdn,
  type IrQuery,
} from "@kb/query";
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { systemSeedNodes, type KbNode } from "@kb/model";

function indexFor(nodes: KbNode[]): DatascriptIndex {
  return new DatascriptIndex(nodes);
}

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
  const index = indexFor([
    ...systemSeedNodes(AT),
    node("n.todo", {
      text: "a todo",
      props: { "sys.f.type": [{ t: "ref", v: "sys.tag" }] },
    }),
  ]);

  test("stored queries: same rows as the original EDN", () => {
    for (const q of STORED_QUERIES) {
      const compiled = compile(parseEdn(q.edn));
      sameRows(index.runDatalog(compiled.query), index.runDatalog(q.edn));
    }
  });
});

type GenClause = IrQuery["where"][number];

function boundNames(where: readonly GenClause[]): string[] {
  const bound = new Set<string>();
  for (const c of where) {
    if (c.kind === "pattern") {
      bound.add(c.entity);
      if (c.value.t === "var") bound.add(c.value.name);
    } else if (c.kind === "children") {
      bound.add(c.parent);
      bound.add(c.child);
    } else if (c.kind === "reach") {
      bound.add(c.from);
      bound.add(c.to);
    }
  }
  return [...bound];
}

function pattern(
  entity: string,
  attr: string,
  value: { t: "var"; name: string } | { t: "str"; value: string },
): GenClause {
  return { kind: "pattern", entity, attr, value };
}

const irArb: fc.Arbitrary<IrQuery> = fc
  .record({
    idLiteral: fc.option(fc.constantFrom("n.todo", "p", "a"), { nil: null }),
    text: fc.constantFrom("omit", "var", "a todo", "leaf"),
    typeJoin: fc.boolean(),
    mentionsJoin: fc.boolean(),
    children: fc.boolean(),
    reach: fc.boolean(),
  })
  .chain((shape) => {
    const where: GenClause[] = [
      pattern(
        "n",
        ":node/id",
        shape.idLiteral === null ? { t: "var", name: "id" } : { t: "str", value: shape.idLiteral },
      ),
    ];
    if (shape.text === "var") where.push(pattern("n", ":node/text", { t: "var", name: "text" }));
    else if (shape.text !== "omit")
      where.push(pattern("n", ":node/text", { t: "str", value: shape.text }));
    if (shape.typeJoin) {
      where.push(pattern("n", ":f/sys.f.type", { t: "var", name: "t" }));
      where.push(pattern("t", ":node/id", { t: "var", name: "tid" }));
    }
    if (shape.mentionsJoin) {
      where.push(pattern("n", ":node/mentions", { t: "var", name: "m" }));
      where.push(pattern("m", ":node/id", { t: "var", name: "mid" }));
    }
    if (shape.children) {
      where.push(pattern("p", ":node/id", { t: "str", value: "p" }));
      where.push({ kind: "children", parent: "p", child: "c" });
      where.push(pattern("c", ":node/id", { t: "var", name: "cid" }));
    }
    if (shape.reach) {
      where.push(pattern("root", ":node/id", { t: "str", value: "a" }));
      where.push({ kind: "reach", from: "root", to: "reached", edge: ":node/mentions" });
      where.push(pattern("reached", ":node/id", { t: "var", name: "rid" }));
    }
    const names = boundNames(where);
    return fc
      .uniqueArray(fc.constantFrom(...names), {
        minLength: 1,
        maxLength: Math.min(2, names.length),
      })
      .map((findNames) => ({
        kind: "query" as const,
        find: findNames.map((name) => ({
          kind: "var" as const,
          name,
          type: name === "text" ? ("scalar" as const) : ("node-ref" as const),
        })),
        where,
      }));
  });

describe("generated IR round-trips through compile(parseEdn(compile(ir)))", () => {
  const index = indexFor([
    node("sys.tag", { text: "tag" }),
    node("n.todo", {
      text: "a todo",
      props: { "sys.f.type": [{ t: "ref", v: "sys.tag" }] },
    }),
    node("p", { children: ["c1", "c2"] }),
    node("c1", { text: "[[c2]]" }),
    node("c2"),
    node("a", { text: "[[b]]" }),
    node("b", { text: "[[c]]" }),
    node("c", { text: "leaf" }),
  ]);

  test("rows match query(edn) on the fixture", () => {
    const outcome = (edn: string, extra: unknown[]) => {
      try {
        return { rows: sortedRows(index.runDatalog(edn, ...extra)) };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    };
    fc.assert(
      fc.property(irArb, (ir) => {
        const compiled = compile(ir);
        const roundTripped = compile(parseEdn(compiled.query));
        const extra = compiled.rules !== undefined ? [compiled.rules] : [];
        expect(outcome(roundTripped.query, extra)).toEqual(outcome(compiled.query, extra));
      }),
      { numRuns: 50 },
    );
  });
});

describe("runIr revives only node-ref positions", () => {
  const index = indexFor([
    node("a", { props: { "fld.status": [{ t: "str", v: "doing" }] } }),
    node("b", { props: { "fld.status": [{ t: "str", v: "doing" }] } }),
    node("c", { props: { "fld.status": [{ t: "str", v: "doing" }] } }),
  ]);
  const edn = "[:find ?v (count ?n) :where [?n :f/fld.status ?v]]";

  test("count-revival: query() collides with an eid; runIr keeps the count", () => {
    const raw = index.runDatalog(edn);
    const ir = parseEdn(edn);
    expect(ir.kind).toBe("query");
    const typed = index.run(ir);
    expect(sortedRows(raw)).toEqual([["doing", "c"]]);
    expect(sortedRows(typed)).toEqual([["doing", 3]]);
  });
});

describe("reach compiles to a recursive DataScript rule", () => {
  const index = indexFor([
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
    const rows = index.run(ir);
    expect(
      sortedRows(rows)
        .map((r) => r[0])
        .toSorted((x, y) => String(x).localeCompare(String(y))),
    ).toEqual(["b", "c"]);
  });
});

describe("children clause replaces the cartesian join", () => {
  const index = indexFor([
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
    const rows = index.run(ir);
    expect(sortedRows(rows)).toHaveLength(3);
  });

  test("child-order as the last clause still collapses", () => {
    const lastClause = `[:find ?id ?i :where [?p :node/id "p"] [?p :node/child ?c] [?c :node/id ?id] [?p :node/child-order ?i]]`;
    const ir = parseEdn(lastClause);
    expect(ir.kind).toBe("query");
    if (ir.kind !== "query") return;
    expect(ir.where.some((c) => c.kind === "children")).toBe(true);
    expect(ir.find.some((p) => p.kind === "var" && p.name === "i")).toBe(false);
    expect(sortedRows(index.runDatalog(lastClause))).toHaveLength(3);
  });
});

const RULES_SUBTAG = `[[(subtag ?child ?parent) [?child :f/sys.f.onto.extends ?parent]]
                       [(subtag ?child ?parent) [?child :f/sys.f.onto.extends ?mid] (subtag ?mid ?parent)]
                       [(has-tag ?n ?tag) [?n :f/sys.f.type ?tag]]
                       [(has-tag ?n ?tag) [?n :f/sys.f.type ?sub] (subtag ?sub ?tag)]]`;

describe("rule-call args are node-ref unless bound as a scalar", () => {
  const index = indexFor([
    node("tag-root", { text: "root-tag" }),
    node("tag-child", {
      text: "child-tag",
      props: { "sys.f.onto.extends": [{ t: "ref", v: "tag-root" }] },
    }),
    node("n-tagged", {
      text: "tagged",
      props: { "sys.f.type": [{ t: "ref", v: "tag-child" }] },
    }),
    node("n-direct", {
      text: "direct",
      props: { "sys.f.type": [{ t: "ref", v: "tag-root" }] },
    }),
  ]);

  test("has-tag bound only by the rule revives through runIr", () => {
    const edn = `[:find ?n :in $ % ?tagId :where [?tag :node/id ?tagId] (has-tag ?n ?tag)]`;
    const ir = parseEdn(edn);
    expect(ir.kind).toBe("query");
    if (ir.kind !== "query") return;
    expect(ir.find).toEqual([{ kind: "var", name: "n", type: "node-ref" }]);
    const rows = index.run(ir, RULES_SUBTAG, "tag-root");
    expect(sortedRows(rows)).toEqual([["n-direct"], ["n-tagged"]]);
  });

  test("a rule arg bound as :node/text stays scalar", () => {
    const ir = parseEdn(`[:find ?text :in $ % :where (has-tag ?n ?tag) [?n :node/text ?text]]`);
    expect(ir.kind).toBe("query");
    if (ir.kind !== "query") return;
    expect(ir.find).toEqual([{ kind: "var", name: "text", type: "scalar" }]);
  });
});
