/**
 * A field declared `cardinality: one` holds at most one value, and the check
 * lives where value conformance does: `txIntegrityError`, the one check every
 * write passes.
 */
import { describe, expect, test } from "bun:test";
import {
  SYSTEM_IDS,
  cardinalityOf,
  systemSeedNodes,
  txIntegrityError,
  type KbNode,
} from "../src/index.ts";

const AT = "2026-01-01T00:00:00.000Z";

function node(id: string, props: KbNode["props"] = {}): KbNode {
  return { id, text: id, props, children: [], createdAt: AT, updatedAt: AT };
}

const SINGLE = node("f.single", {
  [SYSTEM_IDS.fieldTypeField]: [{ t: "ref", v: SYSTEM_IDS.ftNumber }],
  [SYSTEM_IDS.cardinalityField]: [{ t: "ref", v: SYSTEM_IDS.cardinalityOne }],
});
const MULTI = node("f.multi", {
  [SYSTEM_IDS.fieldTypeField]: [{ t: "ref", v: SYSTEM_IDS.ftNumber }],
});

const num = (v: number) => ({ t: "num" as const, v });

describe("cardinality: one", () => {
  test("absent reads as many; the declaration reads as one", () => {
    expect(cardinalityOf(MULTI.props)).toBe("many");
    expect(cardinalityOf(SINGLE.props)).toBe("one");
  });

  test("a second value in a single-valued field is refused, a replacement is not", () => {
    const stored = node("n", { "f.single": [num(95)] });
    const graph = [SINGLE, MULTI, stored];
    const appended = { ...stored, props: { "f.single": [num(95), num(96)] } };
    expect(txIntegrityError(graph, { upserts: [appended], deletes: [] })).toContain(
      "holds one value",
    );
    const replaced = { ...stored, props: { "f.single": [num(96)] } };
    expect(txIntegrityError(graph, { upserts: [replaced], deletes: [] })).toBeNull();
  });

  test("a many-valued field takes any number of values", () => {
    const n = node("n", { "f.multi": [num(1), num(2), num(3)] });
    expect(txIntegrityError([MULTI], { upserts: [n], deletes: [] })).toBeNull();
  });

  test("a legacy second value is not rechecked until the field is written", () => {
    // Stored before the field declared itself single — like lens.all-mentions'
    // link-distance [95, 96] — so an unrelated edit still saves.
    const legacy = node("n", { "f.single": [num(95), num(96)] });
    const renamed = { ...legacy, text: "renamed" };
    expect(txIntegrityError([SINGLE, legacy], { upserts: [renamed], deletes: [] })).toBeNull();
  });

  test("the seed passes its own check, and declares its settings single", () => {
    const seed = systemSeedNodes(AT);
    expect(txIntegrityError([], { upserts: seed, deletes: [] })).toBeNull();
    const byId = new Map(seed.map((n) => [n.id, n]));
    for (const id of [
      SYSTEM_IDS.fieldTypeField,
      SYSTEM_IDS.cardinalityField,
      SYSTEM_IDS.lensRendererField,
      SYSTEM_IDS.lensLinkDistanceField,
      SYSTEM_IDS.viewModeField,
      SYSTEM_IDS.hiddenField,
      SYSTEM_IDS.refTargetField,
    ]) {
      expect(cardinalityOf(byId.get(id)?.props)).toBe("one");
    }
    for (const id of [
      SYSTEM_IDS.typeField,
      SYSTEM_IDS.fieldsField,
      SYSTEM_IDS.lensEdgeKindsField,
      SYSTEM_IDS.viewSortField,
      SYSTEM_IDS.ontoIncludeField,
    ]) {
      expect(cardinalityOf(byId.get(id)?.props)).toBe("many");
    }
  });
});
