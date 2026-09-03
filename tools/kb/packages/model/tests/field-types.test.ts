/**
 * Typed fields seed: sys.f.fieldType / targetTag / targetQuery.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type KbNode } from "../src/model.ts";
import {
  FIELD_TYPES,
  FIELD_TYPE_OPTION_IDS,
  fieldTypeOf,
  fieldTypeValue,
  migrateFieldTypeValues,
} from "../src/field-type.ts";
import { resolveFieldId } from "../src/resolve.ts";
import { ensureSystemSeed, systemSeedNodes } from "../src/seed.ts";

function refs(node: KbNode, field: string): string[] {
  return (node.props[field] ?? []).filter((v) => v.t === "ref").map((v) => v.v);
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

  test("every field type is a node tagged #field-type", () => {
    const byId = new Map(systemSeedNodes().map((n) => [n.id, n]));

    const tag = byId.get(SYSTEM_IDS.fieldTypeTag);
    expect(tag).toBeDefined();
    expect(tag!.text).toBe("field-type");
    expect(refs(tag!, SYSTEM_IDS.typeField)).toEqual([SYSTEM_IDS.tag]);

    for (const type of FIELD_TYPES) {
      const option = byId.get(FIELD_TYPE_OPTION_IDS[type]);
      expect(option, type).toBeDefined();
      expect(option!.text).toBe(type);
      expect(refs(option!, SYSTEM_IDS.typeField)).toEqual([SYSTEM_IDS.fieldTypeTag]);
    }
  });

  test("the type slot is itself an ordinary ref field over that option list", () => {
    // This is what lets the normal ref editor render it: nothing about the
    // type slot is special-cased, it is a ref field with a target tag.
    const byId = new Map(systemSeedNodes().map((n) => [n.id, n]));
    const slot = byId.get(SYSTEM_IDS.fieldTypeField)!;
    expect(fieldTypeOf(slot.props)).toBe("ref");
    expect(refs(slot, SYSTEM_IDS.targetTagField)).toEqual([SYSTEM_IDS.fieldTypeTag]);
  });

  test("a field node templates its own schema fields, like a tag does", () => {
    // One rule — surface the fields your kinds and tags template — has to cover
    // field pages too, or they need a bespoke configurator panel.
    const byId = new Map(systemSeedNodes().map((n) => [n.id, n]));
    expect(refs(byId.get(SYSTEM_IDS.field)!, SYSTEM_IDS.fieldsField)).toEqual([
      SYSTEM_IDS.fieldTypeField,
      SYSTEM_IDS.targetTagField,
      SYSTEM_IDS.targetQueryField,
    ]);
  });

  test("fieldTypeOf reads both the node form and the pre-option-node string", () => {
    // Older stores hold {t:"str"}. Both collapse here, so no migration runs
    // and no downstream code learns about two representations.
    expect(fieldTypeOf({ [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("number")] })).toBe("number");
    expect(fieldTypeOf({ [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: "number" }] })).toBe(
      "number",
    );
    expect(fieldTypeOf({})).toBe("text");
    expect(fieldTypeOf(undefined)).toBe("text");
    // An unknown option id is not a crash and not a silent wrong type.
    expect(fieldTypeOf({ [SYSTEM_IDS.fieldTypeField]: [{ t: "ref", v: "sys.ft.bogus" }] })).toBe(
      "text",
    );
  });

  test("migration rewrites stored type strings to refs, and is idempotent", () => {
    const nodes: KbNode[] = [
      {
        id: "field.a",
        text: "a",
        children: [],
        createdAt: "",
        updatedAt: "",
        props: { [SYSTEM_IDS.fieldTypeField]: [{ t: "str" as const, v: "number" }] },
      },
      {
        id: "field.b",
        text: "b",
        children: [],
        createdAt: "",
        updatedAt: "",
        props: { [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("ref")] },
      },
      {
        id: "n.plain",
        text: "plain",
        children: [],
        createdAt: "",
        updatedAt: "",
        props: {},
      },
    ];

    const first = migrateFieldTypeValues(nodes);
    expect(first.changed).toBe(true);
    const byId = new Map(first.nodes.map((n) => [n.id, n]));
    expect(byId.get("field.a")!.props[SYSTEM_IDS.fieldTypeField]).toEqual([
      fieldTypeValue("number"),
    ]);
    // Already-migrated and unrelated nodes are untouched, by identity.
    expect(byId.get("field.b")).toBe(nodes[1]);
    expect(byId.get("n.plain")).toBe(nodes[2]);

    const again = migrateFieldTypeValues(first.nodes);
    expect(again.changed).toBe(false);
    expect(again.nodes).toBe(first.nodes);
  });

  test("a value that is not a known type name is left alone, not guessed", () => {
    const nodes: KbNode[] = [
      {
        id: "field.weird",
        text: "weird",
        children: [],
        createdAt: "",
        updatedAt: "",
        props: { [SYSTEM_IDS.fieldTypeField]: [{ t: "str" as const, v: "colour" }] },
      },
    ];
    const result = migrateFieldTypeValues(nodes);
    expect(result.changed).toBe(false);
    expect(result.nodes[0]!.props[SYSTEM_IDS.fieldTypeField]).toEqual([{ t: "str", v: "colour" }]);
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
    expect(resolveFieldId(nodes, "targetQuery")).toBe(SYSTEM_IDS.targetQueryField);
    expect(resolveFieldId(nodes, SYSTEM_IDS.fieldTypeField)).toBe(SYSTEM_IDS.fieldTypeField);
  });
});
