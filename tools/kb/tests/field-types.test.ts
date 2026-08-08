/**
 * Typed fields seed: sys.f.fieldType / targetTag / targetQuery.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type KbNode, type PropValue } from "../src/foundation/model.ts";
import { resolveFieldId } from "../src/foundation/resolve.ts";
import { ensureSystemSeed, systemSeedNodes } from "../src/foundation/seed.ts";

function refs(node: KbNode, field: string): string[] {
  return ((node.props[field] ?? []) as PropValue[])
    .filter((v) => v.t === "ref")
    .map((v) => String(v.v));
}

describe("typed field seeds", () => {
  test("seeds sys.f.fieldType, sys.f.targetTag, sys.f.targetQuery as field nodes", () => {
    const seed = systemSeedNodes();
    const byId = new Map(seed.map((n) => [n.id, n]));

    for (const id of [
      SYSTEM_IDS.fieldTypeField,
      SYSTEM_IDS.targetTagField,
      SYSTEM_IDS.targetQueryField,
    ]) {
      const field = byId.get(id);
      expect(field).toBeDefined();
      expect(refs(field!, SYSTEM_IDS.typeField)).toEqual([SYSTEM_IDS.field]);
    }

    expect(byId.get(SYSTEM_IDS.fieldTypeField)!.text).toBe("fieldType");
    expect(byId.get(SYSTEM_IDS.targetTagField)!.text).toBe("targetTag");
    expect(byId.get(SYSTEM_IDS.targetQueryField)!.text).toBe("targetQuery");
  });

  test("ensureSystemSeed is idempotent over typed-field nodes", () => {
    const first = ensureSystemSeed([]);
    expect(first.seeded).toBe(true);
    const again = ensureSystemSeed(first.nodes);
    expect(again.seeded).toBe(false);
    expect(again.nodes.length).toBe(first.nodes.length);
  });

  test("resolveFieldId short aliases for typed-field sys nodes", () => {
    const nodes = systemSeedNodes();
    expect(resolveFieldId(nodes, "fieldType")).toBe(SYSTEM_IDS.fieldTypeField);
    expect(resolveFieldId(nodes, "targetTag")).toBe(SYSTEM_IDS.targetTagField);
    expect(resolveFieldId(nodes, "targetQuery")).toBe(
      SYSTEM_IDS.targetQueryField,
    );
    expect(resolveFieldId(nodes, SYSTEM_IDS.fieldTypeField)).toBe(
      SYSTEM_IDS.fieldTypeField,
    );
  });
});
