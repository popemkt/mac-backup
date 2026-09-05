/**
 * Dual-schema audit: every EDN string the UI runs, on both the forked
 * `buildQueryDb` (ref-typed `:f/*`) and `DatascriptIndex` (prop refs are
 * values; `:f/*` is not a ref attr). Commit 1 of w2 — the safety net.
 */
import { describe, expect, it } from "vitest";
import { present } from "@kb/model";
import {
  DatascriptIndex,
  LIST_ALL_NODES_QUERY,
  LIST_FIELDS_QUERY,
  LIST_TAGS_QUERY,
  backlinksQuery,
} from "@kb/query";
import { fixtureGraph } from "@/fixtures/graph";
import { DEFAULT_QUERY_EDN } from "@/lib/query-node";
import { fieldCarriersQuery, taggedInstancesQuery } from "@/lib/schema-zoom";
import { buildQueryDb } from "./db";
import { runQuery } from "./query";

function sortRows(rows: unknown[][]): string[][] {
  return rows
    .map((row) => row.map((v) => String(v)))
    .toSorted((a, b) => a.join("\0").localeCompare(b.join("\0")));
}

const UI_EDN: Array<{ id: string; source: string; edn: string }> = [
  { id: "queries.list-all", source: "queries.ts", edn: LIST_ALL_NODES_QUERY },
  { id: "queries.list-fields", source: "queries.ts", edn: LIST_FIELDS_QUERY },
  { id: "queries.list-tags", source: "queries.ts", edn: LIST_TAGS_QUERY },
  {
    id: "queries.backlinks-n.root-a",
    source: "queries.ts / references-section.tsx",
    edn: backlinksQuery("n.root-a"),
  },
  { id: "query-node.default", source: "query-node.ts", edn: DEFAULT_QUERY_EDN },
  {
    id: "schema-zoom.tagged-todo",
    source: "schema-zoom.ts / query-results / visible-instances",
    edn: taggedInstancesQuery("tag.todo"),
  },
  {
    id: "schema-zoom.field-status",
    source: "schema-zoom.ts",
    edn: fieldCarriersQuery("field.status"),
  },
  {
    id: "graph-lens.todo-via-id",
    source: "graph-lens.ts (lens.query)",
    edn: '[:find ?id :where [?n :node/id ?id] [?n :f/sys.f.type ?t] [?t :node/id "tag.todo"]]',
  },
  {
    id: "field-type.target-query-text",
    source: "field-type.ts (targetQuery)",
    edn: '[:find ?id :where [?n :node/id ?id] [?n :node/text "Ship kb ui shell"]]',
  },
  {
    id: "ontology-scope.outsider",
    source: "ontology-scope.ts (sys.f.onto.query fixture)",
    edn: '[:find ?id :where [?n :node/text "outsider"] [?n :node/id ?id]]',
  },
  {
    id: "diagnostic.join-via-text",
    source: "query.test.ts — [?n :f/x ?t] [?t :node/text …]",
    edn: '[:find ?id :where [?n :f/sys.f.type ?t] [?t :node/text "todo"] [?n :node/id ?id]]',
  },
  {
    id: "diagnostic.join-via-node-id-value",
    source: "brief pattern — [?n :f/x ?ref] [?t :node/id ?ref]",
    edn: '[:find ?id :where [?n :f/sys.f.type ?ref] [?t :node/id ?ref] [?t :node/text "todo"] [?n :node/id ?id]]',
  },
];

describe("UI datalog under both schemas", () => {
  const oldDb = buildQueryDb(fixtureGraph.nodes, fixtureGraph.rev);
  const index = new DatascriptIndex(fixtureGraph.nodes);

  const table = UI_EDN.map((q) => {
    const forkRows = sortRows(runQuery(oldDb, q.edn));
    const indexRows = sortRows(index.runDatalog(q.edn));
    return {
      id: q.id,
      source: q.source,
      fork: forkRows.length,
      index: indexRows.length,
      same: JSON.stringify(forkRows) === JSON.stringify(indexRows),
    };
  });

  it("pins before/after row counts — zero unexplained diffs", () => {
    expect(table.map((r) => [r.id, r.fork, r.index, r.same])).toEqual([
      ["queries.list-all", 52, 52, true],
      ["queries.list-fields", 26, 26, true],
      ["queries.list-tags", 3, 3, true],
      ["queries.backlinks-n.root-a", 0, 0, true],
      ["query-node.default", 52, 52, true],
      ["schema-zoom.tagged-todo", 2, 2, true],
      ["schema-zoom.field-status", 2, 2, true],
      ["graph-lens.todo-via-id", 2, 2, true],
      ["field-type.target-query-text", 1, 1, true],
      ["ontology-scope.outsider", 0, 0, true],
      ["diagnostic.join-via-text", 2, 2, true],
      ["diagnostic.join-via-node-id-value", 0, 0, true],
    ]);
  });

  it("backlinks with a mention in text match on both schemas", () => {
    const nodes = structuredClone(fixtureGraph.nodes);
    const mentioned = present(
      nodes.find((n) => n.id === "n.root-b"),
      "n.root-b",
    );
    mentioned.text = "See [[n.root-a|Ship]] for context";
    const edn = backlinksQuery("n.root-a");
    const fork = sortRows(runQuery(buildQueryDb(nodes, 1), edn));
    const indexRows = sortRows(new DatascriptIndex(nodes).runDatalog(edn));
    expect(fork.map((r) => r[0])).toContain("n.root-b");
    expect(indexRows).toEqual(fork);
  });
});
