/**
 * V0 — graph perspective seed: #graph-perspective tag + lens fields +
 * default "All mentions" perspective.
 */
import { describe, expect, test } from "bun:test";
import { present } from "../src/present.ts";
import { LEGACY_LENS_ALL_MENTIONS, SYSTEM_IDS, type KbNode } from "../src/model.ts";
import { ensureSystemSeed, systemSeedNodes } from "../src/seed.ts";

function refs(node: KbNode, field: string): string[] {
  return (node.props[field] ?? []).filter((v) => v.t === "ref").map((v) => v.v);
}

function strs(node: KbNode, field: string): string[] {
  return (node.props[field] ?? []).filter((v) => v.t === "str").map((v) => v.v);
}

describe("V0 seed: graph-perspective + lens fields", () => {
  test("seeds lens fields, tag template, and All mentions perspective", () => {
    const seed = systemSeedNodes();
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
      SYSTEM_IDS.lensLayoutField,
      SYSTEM_IDS.lensSpreadField,
      SYSTEM_IDS.lensLinkDistanceField,
      SYSTEM_IDS.lensShowLabelsField,
      SYSTEM_IDS.lensCurvedLinksField,
      SYSTEM_IDS.lensAutorotateField,
      SYSTEM_IDS.lensLabelDensityField,
    ]) {
      const field = present(byId.get(id), `lens field ${id}`);
      expect(refs(field, SYSTEM_IDS.typeField)).toEqual([SYSTEM_IDS.field]);
    }

    const tag = present(byId.get(SYSTEM_IDS.graphPerspectiveTag), "graph-perspective tag");
    expect(tag.text).toBe("graph-perspective");
    expect(refs(tag, SYSTEM_IDS.typeField)).toEqual([SYSTEM_IDS.tag]);
    expect(refs(tag, SYSTEM_IDS.fieldsField)).toEqual([
      SYSTEM_IDS.lensQueryField,
      SYSTEM_IDS.lensRendererField,
      SYSTEM_IDS.lensColorByField,
      SYSTEM_IDS.lensSizeByField,
      SYSTEM_IDS.lensEdgeKindsField,
      SYSTEM_IDS.lensMaxNodesField,
      SYSTEM_IDS.lensClusterByField,
      SYSTEM_IDS.lensFocusField,
      SYSTEM_IDS.lensLayoutField,
      SYSTEM_IDS.lensSpreadField,
      SYSTEM_IDS.lensLinkDistanceField,
      SYSTEM_IDS.lensShowLabelsField,
      SYSTEM_IDS.lensCurvedLinksField,
      SYSTEM_IDS.lensAutorotateField,
      SYSTEM_IDS.lensLabelDensityField,
    ]);

    const perspective = present(byId.get(SYSTEM_IDS.lensAllMentions), "All mentions");
    expect(SYSTEM_IDS.lensAllMentions.startsWith("sys.")).toBe(false);
    expect(perspective.text).toBe("All mentions");
    expect(refs(perspective, SYSTEM_IDS.typeField)).toEqual([SYSTEM_IDS.graphPerspectiveTag]);
    expect(strs(perspective, SYSTEM_IDS.lensRendererField)).toEqual(["force2d"]);
    expect(strs(perspective, SYSTEM_IDS.lensClusterByField)).toEqual(["parent"]);
    expect(strs(perspective, SYSTEM_IDS.lensEdgeKindsField)).toEqual(["mention", "child"]);
  });

  test("ensureSystemSeed is idempotent over lens nodes", () => {
    const first = ensureSystemSeed([]);
    expect(first.seeded).toBe(true);
    const again = ensureSystemSeed(first.nodes);
    expect(again.seeded).toBe(false);
    expect(again.nodes.length).toBe(first.nodes.length);
  });

  test("ensureSystemSeed merges missing lens.cluster-by/focus onto existing tag", () => {
    const at = "2026-08-08T00:00:00.000Z";
    const staleTag: KbNode = {
      id: SYSTEM_IDS.graphPerspectiveTag,
      text: "graph-perspective",
      props: {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
        [SYSTEM_IDS.fieldsField]: [
          { t: "ref", v: SYSTEM_IDS.lensQueryField },
          { t: "ref", v: SYSTEM_IDS.lensRendererField },
        ],
      },
      children: [],
      createdAt: at,
      updatedAt: at,
    };
    const result = ensureSystemSeed([staleTag]);
    expect(result.seeded).toBe(true);
    const tag = present(
      result.nodes.find((n) => n.id === SYSTEM_IDS.graphPerspectiveTag),
      "expected result.nodes.find((n) => n.id === SYSTEM_IDS.graphPerspectiveTag)",
    );
    const fieldIds = refs(tag, SYSTEM_IDS.fieldsField);
    expect(fieldIds).toContain(SYSTEM_IDS.lensClusterByField);
    expect(fieldIds).toContain(SYSTEM_IDS.lensFocusField);
    expect(fieldIds).toContain(SYSTEM_IDS.lensQueryField);

    const again = ensureSystemSeed(result.nodes);
    expect(again.seeded).toBe(false);
  });

  test("migrates legacy sys.lens.all-mentions → lens.all-mentions", () => {
    const at = "2026-08-08T00:00:00.000Z";
    const legacy: KbNode = {
      id: LEGACY_LENS_ALL_MENTIONS,
      text: "All mentions (edited)",
      props: {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.graphPerspectiveTag }],
        [SYSTEM_IDS.lensRendererField]: [{ t: "str", v: "force2d" }],
      },
      children: [],
      createdAt: at,
      updatedAt: at,
    };
    const result = ensureSystemSeed([legacy]);
    expect(result.seeded).toBe(true);
    expect(result.deletes).toEqual([LEGACY_LENS_ALL_MENTIONS]);
    const byId = new Map(result.nodes.map((n) => [n.id, n]));
    expect(byId.has(LEGACY_LENS_ALL_MENTIONS)).toBe(false);
    expect(byId.get(SYSTEM_IDS.lensAllMentions)?.text).toBe("All mentions (edited)");
  });
});
