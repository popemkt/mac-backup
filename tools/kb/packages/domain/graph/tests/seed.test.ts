/**
 * The graph's seed: the lens fields, and the default "All mentions" graph — a
 * view node whose view is the 2D renderer (DESIGN.md → Kinds, roles and
 * options → View nodes). Core's migrations name two of the graph's frozen
 * ids by their spelling; these tests hold the spellings to the graph's.
 */
import { describe, expect, test } from "bun:test";
import {
  LEGACY_SEED_RENAMES,
  PERSPECTIVE_RENDERER_FIELD,
  SYSTEM_IDS,
  cardinalityOf,
  ensureSystemSeed,
  fieldTypeOf,
  present,
  targetQueryOf,
  viewFamilyTargetQuery,
  viewOptionId,
  type KbNode,
} from "@kb/model";
import { bundledSeed } from "@kb/bundled";
import { GRAPH_IDS } from "@kb/graph";

/** The graph's default perspective's id before it lost its `sys.` prefix. */
const LEGACY_LENS_ALL_MENTIONS = "sys.lens.all-mentions";

function refs(node: KbNode, field: string): string[] {
  return (node.props[field] ?? []).filter((v) => v.t === "ref").map((v) => v.v);
}

describe("the graph's seed", () => {
  test("seeds the lens fields, and All mentions as a view node naming the 2D renderer", () => {
    const seed = bundledSeed();
    const byId = new Map(seed.map((n) => [n.id, n]));

    for (const id of [
      SYSTEM_IDS.lensQueryField,
      GRAPH_IDS.lensRendererField,
      GRAPH_IDS.lensColorByField,
      GRAPH_IDS.lensSizeByField,
      GRAPH_IDS.lensEdgeKindsField,
      GRAPH_IDS.lensMaxNodesField,
      GRAPH_IDS.lensClusterByField,
      SYSTEM_IDS.lensFocusField,
      GRAPH_IDS.lensHopsField,
      GRAPH_IDS.lensLabelByField,
      GRAPH_IDS.lensLayoutField,
      GRAPH_IDS.lensSpreadField,
      GRAPH_IDS.lensLinkDistanceField,
      GRAPH_IDS.lensShowLabelsField,
      GRAPH_IDS.lensAutorotateField,
      GRAPH_IDS.lensLabelDensityField,
      GRAPH_IDS.lensThemeField,
      GRAPH_IDS.lensLinkStyleField,
    ]) {
      const field = present(byId.get(id), `lens field ${id}`);
      expect(refs(field, SYSTEM_IDS.typeField)).toEqual([SYSTEM_IDS.field]);
    }

    // The renderer a graph view hosts is one of the renderer views.
    const renderer = present(byId.get(GRAPH_IDS.lensRendererField), "lens.renderer");
    expect(targetQueryOf(renderer)).toBe(viewFamilyTargetQuery("graph.renderer"));
    expect(renderer.children).toEqual([]);

    const graph = present(byId.get(GRAPH_IDS.lensAllMentions), "All mentions");
    expect(GRAPH_IDS.lensAllMentions.startsWith("sys.")).toBe(false);
    expect(graph.text).toBe("All mentions");
    expect(refs(graph, SYSTEM_IDS.typeField)).toEqual([]);
    expect(refs(graph, SYSTEM_IDS.viewField)).toEqual([viewOptionId("graph.force2d")]);
    expect(graph.props[GRAPH_IDS.lensRendererField]).toBeUndefined();
    expect(refs(graph, GRAPH_IDS.lensClusterByField)).toEqual(["sys.graph.source.parent"]);
    expect(refs(graph, GRAPH_IDS.lensEdgeKindsField)).toEqual([
      "sys.graph.source.mentions",
      "sys.graph.source.containment",
    ]);
  });

  test("the lens fields declare their value type and cardinality", () => {
    const byId = new Map(bundledSeed().map((n) => [n.id, n]));
    const declared = (id: string) => present(byId.get(id), id).props;
    for (const id of [GRAPH_IDS.lensRendererField, GRAPH_IDS.lensLinkDistanceField])
      expect(cardinalityOf(declared(id))).toBe("one");
    expect(cardinalityOf(declared(GRAPH_IDS.lensEdgeKindsField))).toBe("many");
    expect(fieldTypeOf(declared(GRAPH_IDS.lensMaxNodesField))).toBe("number");
  });

  test("no #graph-perspective tag is seeded: a graph is a view node", () => {
    const ids = new Set(bundledSeed().map((n) => n.id));
    expect(ids.has("sys.tag.graph-perspective")).toBe(false);
    expect([...ids].some((id) => id.startsWith("sys.graph.renderer."))).toBe(false);
  });

  test("ensureSystemSeed is idempotent over lens nodes", () => {
    const first = ensureSystemSeed([], bundledSeed());
    expect(first.seeded).toBe(true);
    const again = ensureSystemSeed(first.nodes, bundledSeed());
    expect(again.seeded).toBe(false);
    expect(again.nodes.length).toBe(first.nodes.length);
  });

  test("core's migrations name the graph's ids as the graph spells them", () => {
    expect(LEGACY_SEED_RENAMES[LEGACY_LENS_ALL_MENTIONS]).toBe(GRAPH_IDS.lensAllMentions);
    expect(PERSPECTIVE_RENDERER_FIELD).toBe(GRAPH_IDS.lensRendererField);
  });

  test("migrates legacy sys.lens.all-mentions → lens.all-mentions", () => {
    const at = "2026-08-08T00:00:00.000Z";
    const legacy: KbNode = {
      id: LEGACY_LENS_ALL_MENTIONS,
      text: "All mentions (edited)",
      props: { [SYSTEM_IDS.viewField]: [{ t: "ref", v: viewOptionId("graph.tree") }] },
      children: [],
      createdAt: at,
      updatedAt: at,
    };
    const result = ensureSystemSeed([legacy], bundledSeed());
    expect(result.seeded).toBe(true);
    expect(result.deletes).toEqual([LEGACY_LENS_ALL_MENTIONS]);
    const byId = new Map(result.nodes.map((n) => [n.id, n]));
    expect(byId.has(LEGACY_LENS_ALL_MENTIONS)).toBe(false);
    const kept = present(byId.get(GRAPH_IDS.lensAllMentions), "All mentions");
    expect(kept.text).toBe("All mentions (edited)");
    // The owner's renderer survives the seed's fill-absent pass.
    expect(refs(kept, SYSTEM_IDS.viewField)).toEqual([viewOptionId("graph.tree")]);
  });
});
