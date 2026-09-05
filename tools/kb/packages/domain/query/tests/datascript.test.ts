/**
 * Execution-half red cases from r4 (reports/backend-recon/README.md §8):
 * recursive `%` rules via graph.query, and the `:node/child-order` cartesian.
 */
import { describe, expect, test } from "bun:test";
import type { KbNode } from "@kb/model";
import { DatascriptIndex, normalizeEdnQuery, parseEdn } from "@kb/query";

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

/** Exact MCP-shaped recursive rule from r4's Q4 (bench/run-datascript.ts). */
const RULES_SUBTAG = `[[(subtag ?child ?parent) [?child :f/sys.f.onto.extends ?parent]]
                       [(subtag ?child ?parent) [?child :f/sys.f.onto.extends ?mid] (subtag ?mid ?parent)]
                       [(has-tag ?n ?tag) [?n :f/sys.f.type ?tag]]
                       [(has-tag ?n ?tag) [?n :f/sys.f.type ?sub] (subtag ?sub ?tag)]]`;

const Q4 = `[:find ?id :in $ % ?tagId :where [?tag :node/id ?tagId] (has-tag ?n ?tag) [?n :node/id ?id]]`;

const CARTESIAN_CHILDREN = `[:find ?cId ?ord :in $ ?parentId
  :where [?p :node/id ?parentId] [?p :node/child ?c] [?p :node/child-order ?ord] [?c :node/id ?cId]]`;

describe("query() normalises rules inputs", () => {
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
    node("n-other", { text: "other" }),
  ]);

  test("recursive rule via runDatalog (was throw, now rows)", () => {
    expect(parseEdn(Q4).kind).toBe("query");
    expect(normalizeEdnQuery(RULES_SUBTAG)).toContain('":f/sys.f.onto.extends"');
    const rows = index.runDatalog(Q4, RULES_SUBTAG, "tag-root");
    const ids = rows.map((r) => r[0]).toSorted((a, b) => String(a).localeCompare(String(b)));
    expect(ids).toEqual(["n-direct", "n-tagged"]);
  });

  test("runIr normalises a rules vector supplied as %", () => {
    const ir = parseEdn(Q4);
    expect(ir.kind).toBe("query");
    const rows = index.run(ir, RULES_SUBTAG, "tag-root");
    const ids = rows
      .map((r) => (Array.isArray(r) ? r[0] : r))
      .toSorted((a, b) => String(a).localeCompare(String(b)));
    expect(ids).toEqual(["n-direct", "n-tagged"]);
  });
});

describe("query() stops the child-order cartesian", () => {
  const index = indexFor([
    node("p", { text: "parent", children: ["c1", "c2", "c3"] }),
    node("c1", { text: "one" }),
    node("c2", { text: "two" }),
    node("c3", { text: "three" }),
  ]);

  test("a parent with several children returns one row per child, not N×N", () => {
    const rows = index.runDatalog(CARTESIAN_CHILDREN, "p");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r[0]).toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
  });

  test("child-set without the order join is unchanged", () => {
    const rows = index.runDatalog(
      `[:find ?cId :in $ ?parentId :where [?p :node/id ?parentId] [?p :node/child ?c] [?c :node/id ?cId]]`,
      "p",
    );
    expect(rows).toHaveLength(3);
  });

  test("child-order as the last clause still returns one row per child", () => {
    const rows = index.runDatalog(
      `[:find ?id ?i :where [?p :node/id "p"] [?p :node/child ?c] [?c :node/id ?id] [?p :node/child-order ?i]]`,
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r[0]).toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
  });
});

describe("query() still revives eids on the raw surface", () => {
  const index = indexFor([node("a", { text: "alpha" })]);

  test("entity find positions revive to NodeId", () => {
    const rows = index.runDatalog('[:find ?n :where [?n :node/text "alpha"]]');
    expect(rows).toEqual([["a"]]);
  });
});
