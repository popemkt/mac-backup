/**
 * Every EDN string the UI runs, pinned against DatascriptIndex on the
 * fixture graph. Commit 1 compared this replica to the deleted fork; the
 * counts below are that table, now a regression suite for the one schema.
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
import { fixtureGraph } from "@/api/fixture-graph";
import { DEFAULT_QUERY_EDN } from "@/lib/query-node";
import { fieldCarriersQuery, taggedInstancesQuery } from "@/lib/schema-zoom";

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

describe("UI datalog on DatascriptIndex", () => {
  const index = new DatascriptIndex(fixtureGraph.nodes);

  const table = UI_EDN.map((q) => ({
    id: q.id,
    source: q.source,
    rows: sortRows(index.runDatalog(q.edn)).length,
  }));

  it("pins row counts — zero unexplained diffs from the commit-1 audit", () => {
    expect(table.map((r) => [r.id, r.rows])).toEqual([
      ["queries.list-all", 51],
      ["queries.list-fields", 26],
      ["queries.list-tags", 2],
      ["queries.backlinks-n.root-a", 0],
      ["query-node.default", 51],
      ["schema-zoom.tagged-todo", 2],
      ["schema-zoom.field-status", 2],
      ["graph-lens.todo-via-id", 2],
      ["field-type.target-query-text", 1],
      ["ontology-scope.outsider", 0],
      ["diagnostic.join-via-text", 2],
      ["diagnostic.join-via-node-id-value", 0],
    ]);
  });

  it("backlinks with a mention in text match", () => {
    const nodes = structuredClone(fixtureGraph.nodes);
    const mentioned = present(
      nodes.find((n) => n.id === "n.root-b"),
      "n.root-b",
    );
    mentioned.text = "See [[n.root-a|Ship]] for context";
    const rows = sortRows(new DatascriptIndex(nodes).runDatalog(backlinksQuery("n.root-a")));
    expect(rows.map((r) => r[0])).toContain("n.root-b");
  });
});
