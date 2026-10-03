/**
 * Typed fields seed: sys.f.fieldType / targetTag / targetQuery.
 */
import { describe, expect, test } from "bun:test";
import { present } from "../src/present.ts";
import { SYSTEM_IDS, type KbNode, type PropValue } from "../src/model.ts";
import {
  declaresOptionSet,
  FIELD_TYPES,
  FIELD_TYPE_OPTION_IDS,
  acceptsValueKind,
  type FieldType,
  fieldTypeOf,
  fieldTypeValue,
  migrateFieldTypeValues,
} from "../src/field-type.ts";
import { resolveFieldId } from "../src/resolve.ts";
import { ensureSystemSeed } from "../src/seed.ts";
import { bundledSeed } from "@kb/bundled";

function refs(node: KbNode, field: string): string[] {
  return (node.props[field] ?? []).filter((v) => v.t === "ref").map((v) => v.v);
}

describe("typed field seeds", () => {
  test("seeds sys.f.fieldType, sys.f.targetTag, sys.f.targetQuery as field nodes", () => {
    const seed = bundledSeed();
    const byId = new Map(seed.map((n) => [n.id, n]));

    for (const id of [
      SYSTEM_IDS.fieldTypeField,
      SYSTEM_IDS.targetTagField,
      SYSTEM_IDS.targetQueryField,
    ]) {
      const field = byId.get(id);
      expect(field).toBeDefined();
      expect(refs(present(field, "expected field"), SYSTEM_IDS.typeField)).toEqual([
        SYSTEM_IDS.field,
      ]);
    }

    expect(
      present(byId.get(SYSTEM_IDS.fieldTypeField), "expected byId.get(SYSTEM_IDS.fieldTypeField)")
        .text,
    ).toBe("fieldType");
    expect(
      present(byId.get(SYSTEM_IDS.targetTagField), "expected byId.get(SYSTEM_IDS.targetTagField)")
        .text,
    ).toBe("targetTag");
    expect(
      present(
        byId.get(SYSTEM_IDS.targetQueryField),
        "expected byId.get(SYSTEM_IDS.targetQueryField)",
      ).text,
    ).toBe("targetQuery");
  });

  test("every seeded field declares its value type — none leans on the text default", () => {
    const fields = bundledSeed().filter((n) =>
      refs(n, SYSTEM_IDS.typeField).includes(SYSTEM_IDS.field),
    );
    expect(fields.length).toBeGreaterThan(0);
    const undeclared = fields
      .filter((n) => (n.props[SYSTEM_IDS.fieldTypeField] ?? []).length !== 1)
      .map((n) => n.id);
    expect(undeclared).toEqual([]);
    const byId = new Map(fields.map((n) => [n.id, n]));
    expect(fieldTypeOf(byId.get(SYSTEM_IDS.typeField)?.props)).toBe("ref");
    expect(fieldTypeOf(byId.get(SYSTEM_IDS.hiddenField)?.props)).toBe("checkbox");
    expect(fieldTypeOf(byId.get(SYSTEM_IDS.lensMaxNodesField)?.props)).toBe("number");
  });

  test("every field type is a plain child of the type field — no supertag", () => {
    // "text" is not a kind of thing, it is one of the values fieldType may
    // take, so it carries no kind ref at all: being a child says it.
    const byId = new Map(bundledSeed().map((n) => [n.id, n]));
    const slot = present(
      byId.get(SYSTEM_IDS.fieldTypeField),
      "expected byId.get(SYSTEM_IDS.fieldTypeField)",
    );

    expect(slot.children).toEqual(FIELD_TYPES.map((type) => FIELD_TYPE_OPTION_IDS[type]));
    for (const type of FIELD_TYPES) {
      const option = byId.get(FIELD_TYPE_OPTION_IDS[type]);
      expect(option, type).toBeDefined();
      expect(present(option, "expected option").text).toBe(type);
      expect(refs(present(option, "expected option"), SYSTEM_IDS.typeField)).toEqual([]);
    }
  });

  test("the type slot is itself an ordinary ref field over that option list", () => {
    // This is what lets the normal ref editor render it: nothing about the
    // type slot is special-cased, it is a ref field whose options are its
    // children — the same declaration a user's own option list makes.
    const byId = new Map(bundledSeed().map((n) => [n.id, n]));
    const slot = present(
      byId.get(SYSTEM_IDS.fieldTypeField),
      "expected byId.get(SYSTEM_IDS.fieldTypeField)",
    );
    expect(fieldTypeOf(slot.props)).toBe("ref");
    expect(refs(slot, SYSTEM_IDS.targetTagField)).toEqual([]);
    expect(refs(slot, SYSTEM_IDS.targetQueryField)).toEqual([]);
  });

  test("a field node templates its own schema fields, like a tag does", () => {
    // One rule — surface the fields your kinds and tags template — has to cover
    // field pages too, or they need a bespoke configurator panel.
    const byId = new Map(bundledSeed().map((n) => [n.id, n]));
    expect(
      refs(
        present(byId.get(SYSTEM_IDS.field), "expected byId.get(SYSTEM_IDS.field)"),
        SYSTEM_IDS.fieldsField,
      ),
    ).toEqual([
      SYSTEM_IDS.fieldTypeField,
      SYSTEM_IDS.cardinalityField,
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
    expect(
      present(byId.get("field.a"), 'expected byId.get("field.a")').props[SYSTEM_IDS.fieldTypeField],
    ).toEqual([fieldTypeValue("number")]);
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
    expect(
      present(result.nodes[0], "expected result.nodes[0]").props[SYSTEM_IDS.fieldTypeField],
    ).toEqual([{ t: "str", v: "colour" }]);
  });

  test("ensureSystemSeed is idempotent over typed-field nodes", () => {
    const first = ensureSystemSeed([], bundledSeed());
    expect(first.seeded).toBe(true);
    const again = ensureSystemSeed(first.nodes, bundledSeed());
    expect(again.seeded).toBe(false);
    expect(again.nodes.length).toBe(first.nodes.length);
  });

  test("resolveFieldId short aliases for typed-field sys nodes", () => {
    const nodes = bundledSeed();
    expect(resolveFieldId(nodes, "fieldType")).toBe(SYSTEM_IDS.fieldTypeField);
    expect(resolveFieldId(nodes, "targetTag")).toBe(SYSTEM_IDS.targetTagField);
    expect(resolveFieldId(nodes, "targetQuery")).toBe(SYSTEM_IDS.targetQueryField);
    expect(resolveFieldId(nodes, SYSTEM_IDS.fieldTypeField)).toBe(SYSTEM_IDS.fieldTypeField);
  });
});

const VALUE_KINDS: PropValue["t"][] = ["str", "num", "bool", "date", "ref"];

function sampleOfKind(t: PropValue["t"]): PropValue {
  if (t === "num") return { t, v: 1 };
  if (t === "bool") return { t, v: true };
  return { t, v: "x" };
}

describe("accepted value kinds", () => {
  const accepted = (type: FieldType): PropValue["t"][] =>
    VALUE_KINDS.filter((t) => acceptsValueKind(type, sampleOfKind(t)));

  test("each declared type accepts exactly its kinds", () => {
    expect(Object.fromEntries(FIELD_TYPES.map((type) => [type, accepted(type)]))).toEqual({
      text: ["str"],
      number: ["num"],
      date: ["str"],
      url: ["str"],
      checkbox: ["bool"],
      ref: ["ref"],
    });
  });
});

const optionField = (over: Partial<KbNode>): KbNode => ({
  id: "f.status",
  text: "status",
  props: { [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("ref")] },
  children: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("an option set is declared by parenting", () => {
  test("a ref field with children and no other declaration holds options", () => {
    expect(declaresOptionSet(optionField({ children: ["opt.a"] }))).toBe(true);
    expect(declaresOptionSet(optionField({}))).toBe(false);
    expect(declaresOptionSet(undefined)).toBe(false);
  });

  test("a query or a tag outranks the children, as it does for the allowed set", () => {
    const tagged = optionField({
      children: ["opt.a"],
      props: { [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: "t.x" }] },
    });
    const queried = optionField({
      children: ["opt.a"],
      props: {
        [SYSTEM_IDS.targetQueryField]: [{ t: "str", v: "[:find ?id :where [?n :node/id ?id]]" }],
      },
    });
    expect(declaresOptionSet(tagged)).toBe(false);
    expect(declaresOptionSet(queried)).toBe(false);
  });
});
