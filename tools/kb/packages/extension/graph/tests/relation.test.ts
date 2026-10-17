/**
 * Typing a relation (`typedRelation`): one ref prop added, the text left
 * alone, idempotent, and refused for a field that is no ref or a target the
 * field does not allow (`@kb/model`'s `relationFieldFit`, whose own test is
 * `relation.test.ts` there). Inverse labels read back a typed hop
 * (`hopLabelsOf`).
 */
import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { SYSTEM_IDS, fieldTypeValue, type KbNode } from "@kb/model";
import { GRAPH_IDS, hopLabelsOf, suggestsRelations, typedRelation } from "../src/index.ts";

const AT = "2026-10-17T00:00:00.000Z";

function kb(partial: Pick<KbNode, "id" | "text"> & Partial<KbNode>): KbNode {
  return { props: {}, children: [], createdAt: AT, updatedAt: AT, ...partial };
}

function fieldNode(id: string, type: "ref" | "text", extra: KbNode["props"] = {}): KbNode {
  return kb({
    id,
    text: id.slice(2),
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
      [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue(type)],
      ...extra,
    },
  });
}

const nodes = new Map(
  [
    kb({ id: "a", text: "A mentions [[b]]" }),
    kb({ id: "b", text: "B", props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: "t.idea" }] } }),
    kb({ id: "c", text: "C" }),
    fieldNode("f.influences", "ref", {
      [SYSTEM_IDS.relationInverseField]: [{ t: "str", v: "influenced by" }],
    }),
    fieldNode("f.note", "text"),
    fieldNode("f.about", "ref", { [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: "t.idea" }] }),
    fieldNode("f.owner", "ref", {
      [SYSTEM_IDS.cardinalityField]: [{ t: "ref", v: SYSTEM_IDS.cardinalityOne }],
    }),
  ].map((n) => [n.id, n]),
);
const noQuery = () => [];
const type = (field: string, target = "b", over = nodes) =>
  typedRelation(over, { source: "a", target, field }, noQuery, AT);

function code(typed: ReturnType<typeof type>): string {
  return Result.isFailure(typed) ? typed.failure.code : "typed";
}

describe("typedRelation", () => {
  test("adds exactly one ref prop to the source, and keeps its text", () => {
    const typed = type("f.influences");
    const expected: KbNode = kb({
      id: "a",
      text: "A mentions [[b]]",
      props: { "f.influences": [{ t: "ref", v: "b" }] },
    });
    expect(Result.isSuccess(typed) ? typed.success : null).toEqual(expected);
  });

  test("typing a relation the source holds writes nothing", () => {
    const once = type("f.influences");
    if (!Result.isSuccess(once) || once.success === null) throw new Error("not typed");
    const after = new Map(nodes).set("a", once.success);
    expect(type("f.influences", "b", after)).toEqual(Result.succeed(null));
  });

  test("refuses a field that is no ref, a system field, a target it does not allow, and a full one-valued field", () => {
    expect(code(type("f.note"))).toBe("invalid_input");
    expect(code(type("f.about", "c"))).toBe("invalid_input");
    expect(code(type("f.about", "b"))).toBe("typed");
    expect(code(type("f.missing"))).toBe("not_found");
    const kept = new Map(nodes).set("sys.f.kept", fieldNode("sys.f.kept", "ref"));
    expect(code(type("sys.f.kept", "b", kept))).toBe("invalid_input");
    const owned = new Map(nodes).set(
      "a",
      kb({ id: "a", text: "A", props: { "f.owner": [{ t: "ref", v: "c" }] } }),
    );
    expect(code(type("f.owner", "b", owned))).toBe("conflict");
  });
});

describe("hopLabelsOf", () => {
  test("a relation is its field's text, read back by its inverse when it has one", () => {
    const labels = hopLabelsOf([...nodes.values()]);
    expect(labels.relationOf("f.influences")).toEqual({
      label: "influences",
      inverse: "influenced by",
    });
    expect(labels.relationOf("f.about")).toEqual({ label: "about", inverse: null });
    expect(labels.textOf("a")).toBe("A mentions B");
  });
});

describe("suggestsRelations", () => {
  test("the family's setting is off until its node says it is on", () => {
    expect(suggestsRelations(undefined)).toBe(false);
    expect(suggestsRelations({ props: {} })).toBe(false);
    expect(
      suggestsRelations({ props: { [GRAPH_IDS.suggestRelationsField]: [{ t: "bool", v: true }] } }),
    ).toBe(true);
  });
});
