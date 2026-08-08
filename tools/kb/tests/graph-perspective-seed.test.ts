/**
 * V0 — graph perspective seed: #graph-perspective tag + lens fields +
 * default "All mentions" perspective.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type KbNode, type PropValue } from "../src/foundation/model.ts";
import { ensureSystemSeed, systemSeedNodes } from "../src/foundation/seed.ts";

function refs(node: KbNode, field: string): string[] {
  return ((node.props[field] ?? []) as PropValue[])
    .filter((v) => v.t === "ref")
    .map((v) => String(v.v));
}

function strs(node: KbNode, field: string): string[] {
  return ((node.props[field] ?? []) as PropValue[])
    .filter((v) => v.t === "str")
    .map((v) => String(v.v));
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
    ]) {
      const field = byId.get(id);
      expect(field).toBeDefined();
      expect(refs(field!, SYSTEM_IDS.typeField)).toEqual([SYSTEM_IDS.field]);
    }

    const tag = byId.get(SYSTEM_IDS.graphPerspectiveTag);
    expect(tag).toBeDefined();
    expect(tag!.text).toBe("graph-perspective");
    expect(refs(tag!, SYSTEM_IDS.typeField)).toEqual([SYSTEM_IDS.tag]);
    expect(refs(tag!, SYSTEM_IDS.fieldsField)).toEqual([
      SYSTEM_IDS.lensQueryField,
      SYSTEM_IDS.lensRendererField,
      SYSTEM_IDS.lensColorByField,
      SYSTEM_IDS.lensSizeByField,
      SYSTEM_IDS.lensEdgeKindsField,
      SYSTEM_IDS.lensMaxNodesField,
    ]);

    const perspective = byId.get(SYSTEM_IDS.lensAllMentions);
    expect(perspective).toBeDefined();
    expect(perspective!.text).toBe("All mentions");
    expect(refs(perspective!, SYSTEM_IDS.typeField)).toEqual([
      SYSTEM_IDS.graphPerspectiveTag,
    ]);
    expect(strs(perspective!, SYSTEM_IDS.lensRendererField)).toEqual([
      "force2d",
    ]);
    expect(strs(perspective!, SYSTEM_IDS.lensEdgeKindsField)).toEqual([
      "mention",
      "child",
    ]);
  });

  test("ensureSystemSeed is idempotent over lens nodes", () => {
    const first = ensureSystemSeed([]);
    expect(first.seeded).toBe(true);
    const again = ensureSystemSeed(first.nodes);
    expect(again.seeded).toBe(false);
    expect(again.nodes.length).toBe(first.nodes.length);
  });
});
