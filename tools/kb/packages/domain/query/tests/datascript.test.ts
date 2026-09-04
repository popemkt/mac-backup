/**
 * Execution-half red cases from r4 (reports/backend-recon/README.md §8):
 * recursive `%` rules via graph.query, and the `:node/child-order` cartesian.
 */
import { describe, expect, test } from "bun:test";
import type { KbNode } from "@kb/model";
import { DatascriptIndex, normalizeEdnQuery, query, queryRows } from "@kb/query";

/** The engine handle these tests drive directly, built the one way there is. */
function handleFor(nodes: KbNode[]) {
  return new DatascriptIndex(nodes).handle;
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

/** Exact MCP-shaped recursive rule from r4's Q4 (bench/run-datascript.ts). */
const RULES_SUBTAG = `[[(subtag ?child ?parent) [?child :f/sys.f.onto.extends ?parent]]
                       [(subtag ?child ?parent) [?child :f/sys.f.onto.extends ?mid] (subtag ?mid ?parent)]
                       [(has-tag ?n ?tag) [?n :f/sys.f.type ?tag]]
                       [(has-tag ?n ?tag) [?n :f/sys.f.type ?sub] (subtag ?sub ?tag)]]`;

const Q4 = `[:find ?id :in $ % ?tagId :where [?tag :node/id ?tagId] (has-tag ?n ?tag) [?n :node/id ?id]]`;

const CARTESIAN_CHILDREN = `[:find ?cId ?ord :in $ ?parentId
  :where [?p :node/id ?parentId] [?p :node/child ?c] [?p :node/child-order ?ord] [?c :node/id ?cId]]`;

describe("query() normalises rules inputs", () => {
  const db = handleFor([
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
    node("n-other", { text: "other" }),
  ]);

  test("recursive rule via runDatalog (was throw, now rows)", () => {
    expect(normalizeEdnQuery(RULES_SUBTAG)).toContain('":f/sys.f.onto.extends"');
    const rows = queryRows(db, Q4, RULES_SUBTAG, "tag-root");
    const ids = rows.map((r) => r[0]).toSorted((a, b) => String(a).localeCompare(String(b)));
    expect(ids).toEqual(["n-direct", "n-tagged"]);
  });
});

describe("query() stops the child-order cartesian", () => {
  const db = handleFor([
    node("p", { text: "parent", children: ["c1", "c2", "c3"] }),
    node("c1", { text: "one" }),
    node("c2", { text: "two" }),
    node("c3", { text: "three" }),
  ]);

  test("a parent with several children returns one row per child, not N×N", () => {
    const rows = queryRows(db, CARTESIAN_CHILDREN, "p");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r[0]).toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
  });

  test("child-set without the order join is unchanged", () => {
    const rows = queryRows(
      db,
      `[:find ?cId :in $ ?parentId :where [?p :node/id ?parentId] [?p :node/child ?c] [?c :node/id ?cId]]`,
      "p",
    );
    expect(rows).toHaveLength(3);
  });
});

describe("query() still revives eids on the raw surface", () => {
  const db = handleFor([node("a", { text: "alpha" })]);

  test("entity find positions revive to NodeId", () => {
    const rows = query(db, '[:find ?n :where [?n :node/text "alpha"]]');
    expect(rows).toEqual([["a"]]);
  });
});
