/**
 * The view queries `@kb/model` declares, run on the seed: what `sys.f.view`
 * may name, what a family's options are, and which view nodes a family lists.
 */
import { describe, expect, test } from "bun:test";
import {
  SYSTEM_IDS,
  VIEW_NODE_TARGET_QUERY,
  VIEW_OPTION_TARGET_QUERY,
  VIEW_FAMILY_VALUES,
  familyViewNodesQuery,
  viewFamilyTargetQuery,
  viewOptionId,
  type KbNode,
} from "@kb/model";
import { DatascriptIndex, parseEdn } from "@kb/query";
import { bundledSeed } from "@kb/bundled";

const AT = "2026-01-01T00:00:00.000Z";
const viewNode = (id: string, viewId: string): KbNode => ({
  id,
  text: id,
  props: { [SYSTEM_IDS.viewField]: [{ t: "ref", v: viewOptionId(viewId) }] },
  children: [],
  createdAt: AT,
  updatedAt: AT,
});

const seed = bundledSeed(AT);
/** The view options the seed files under `sys.views`. */
const optionIds = new Set(seed.find((node) => node.id === SYSTEM_IDS.viewsRoot)?.children);
const options = seed.filter((node) => optionIds.has(node.id));

const index = new DatascriptIndex([
  ...seed,
  viewNode("v.table", "outline.table"),
  viewNode("v.tree", "graph.tree"),
  viewNode("v.nb", "graph.neighbourhood"),
]);
const ids = (edn: string) =>
  index
    .runDatalog(edn)
    .map((row) => String(row[0]))
    .toSorted();

describe("view queries", () => {
  test("each compiles in the subset, never raw", () => {
    for (const edn of [
      VIEW_OPTION_TARGET_QUERY,
      VIEW_NODE_TARGET_QUERY,
      viewFamilyTargetQuery("graph.renderer"),
      familyViewNodesQuery("outline.frame"),
    ])
      expect(parseEdn(edn).kind, edn).toBe("query");
  });

  test("sys.f.view may name every view option, and nothing else", () => {
    expect(ids(VIEW_OPTION_TARGET_QUERY)).toEqual(options.map((option) => option.id).toSorted());
  });

  test("a family's options are exactly the views declared in it", () => {
    const renderers = options
      .filter(
        (option) =>
          option.props[SYSTEM_IDS.viewFamilyField]?.[0]?.v ===
          VIEW_FAMILY_VALUES["graph.renderer"].id,
      )
      .map((option) => option.id)
      .toSorted();
    expect(renderers.length).toBeGreaterThan(0);
    expect(ids(viewFamilyTargetQuery("graph.renderer"))).toEqual(renderers);
  });

  test("a family lists the view nodes whose view is in it, and sys.f.views may name any view node", () => {
    // The seed's own graph, All mentions, is one of them, and its approval
    // policies table another.
    expect(ids(familyViewNodesQuery("graph.renderer"))).toEqual([
      SYSTEM_IDS.lensAllMentions,
      "v.tree",
    ]);
    expect(ids(familyViewNodesQuery("outline.frame"))).toEqual([
      "v.table",
      SYSTEM_IDS.approvalPoliciesView,
    ]);
    expect(ids(VIEW_NODE_TARGET_QUERY)).toEqual([
      SYSTEM_IDS.lensAllMentions,
      "v.nb",
      "v.table",
      "v.tree",
      SYSTEM_IDS.approvalPoliciesView,
    ]);
  });
});
