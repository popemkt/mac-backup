/**
 * The graph's seed: the lens fields, and the default "All mentions" graph — a
 * view node whose view is the 2D renderer (DESIGN.md → Kinds, roles and
 * options → View nodes).
 */
import { describe, expect, test } from "bun:test";
import { present } from "../src/present.ts";
import { LEGACY_LENS_ALL_MENTIONS, SYSTEM_IDS, type KbNode } from "../src/model.ts";
import { ensureSystemSeed } from "../src/seed.ts";
import { viewFamilyTargetQuery, viewOptionId } from "../src/view-node.ts";
import { targetQueryOf } from "../src/field-type.ts";
import { bundledSeed } from "@kb/bundled";

function refs(node: KbNode, field: string): string[] {
  return (node.props[field] ?? []).filter((v) => v.t === "ref").map((v) => v.v);
}

describe("the graph's seed", () => {
  test("seeds the lens fields, and All mentions as a view node naming the 2D renderer", () => {
    const seed = bundledSeed();
    const byId = new Map(seed.map((n) => [n.id, n]));

    for (const id of [
      SYSTEM_IDS.lensQueryField,
      SYSTEM_IDS.lensRendererField,
      SYSTEM_IDS.lensColorByField,
      SYSTEM_IDS.lensSizeByField,
      SYSTEM_IDS.lensEdgeKindsField,
      SYSTEM_IDS.lensMaxNodesField,
      SYSTEM_IDS.lensClusterByField,
      SYSTEM_IDS.lensFocusField,
      SYSTEM_IDS.lensHopsField,
      SYSTEM_IDS.lensLabelByField,
      SYSTEM_IDS.lensLayoutField,
      SYSTEM_IDS.lensSpreadField,
      SYSTEM_IDS.lensLinkDistanceField,
      SYSTEM_IDS.lensShowLabelsField,
      SYSTEM_IDS.lensAutorotateField,
      SYSTEM_IDS.lensLabelDensityField,
      SYSTEM_IDS.lensThemeField,
      SYSTEM_IDS.lensLinkStyleField,
    ]) {
      const field = present(byId.get(id), `lens field ${id}`);
      expect(refs(field, SYSTEM_IDS.typeField)).toEqual([SYSTEM_IDS.field]);
    }

    // The renderer a graph view hosts is one of the renderer views.
    const renderer = present(byId.get(SYSTEM_IDS.lensRendererField), "lens.renderer");
    expect(targetQueryOf(renderer)).toBe(viewFamilyTargetQuery("graph.renderer"));
    expect(renderer.children).toEqual([]);

    const graph = present(byId.get(SYSTEM_IDS.lensAllMentions), "All mentions");
    expect(SYSTEM_IDS.lensAllMentions.startsWith("sys.")).toBe(false);
    expect(graph.text).toBe("All mentions");
    expect(refs(graph, SYSTEM_IDS.typeField)).toEqual([]);
    expect(refs(graph, SYSTEM_IDS.viewField)).toEqual([viewOptionId("graph.force2d")]);
    expect(graph.props[SYSTEM_IDS.lensRendererField]).toBeUndefined();
    expect(refs(graph, SYSTEM_IDS.lensClusterByField)).toEqual(["sys.graph.source.parent"]);
    expect(refs(graph, SYSTEM_IDS.lensEdgeKindsField)).toEqual([
      "sys.graph.source.mentions",
      "sys.graph.source.containment",
    ]);
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
    const kept = present(byId.get(SYSTEM_IDS.lensAllMentions), "All mentions");
    expect(kept.text).toBe("All mentions (edited)");
    // The owner's renderer survives the seed's fill-absent pass.
    expect(refs(kept, SYSTEM_IDS.viewField)).toEqual([viewOptionId("graph.tree")]);
  });
});
