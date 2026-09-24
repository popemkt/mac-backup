/**
 * A written value conforms to its field, or the transaction is invalid.
 *
 * `txIntegrityError` is the one check every write passes, so conformance is
 * asserted through it rather than through `valueConformanceError` alone: what
 * matters is which transactions the store refuses. Three properties carry the
 * rule — kind acceptance per declared type, refs naming a stored node, and
 * "written" meaning new relative to the stored node — plus the seed, which
 * every store starts from and which must pass its own check.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  FIELD_TYPES,
  SYSTEM_IDS,
  acceptsValueKind,
  fieldTypeValue,
  systemSeedNodes,
  txIntegrityError,
  type FieldType,
  type KbNode,
  type PropValue,
} from "../src/index.ts";
import { valueConformanceError } from "../src/field-type.ts";

const AT = "2026-01-01T00:00:00.000Z";

function node(id: string, props: KbNode["props"] = {}): KbNode {
  return { id, text: id, props, children: [], createdAt: AT, updatedAt: AT };
}

function field(id: string, type: FieldType | null): KbNode {
  return node(id, type === null ? {} : { [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue(type)] });
}

const TARGET = "n.target";

const valueArb: fc.Arbitrary<PropValue> = fc.oneof(
  fc.string({ maxLength: 6 }).map((v): PropValue => ({ t: "str", v })),
  fc.integer().map((v): PropValue => ({ t: "num", v })),
  fc.boolean().map((v): PropValue => ({ t: "bool", v })),
  fc.constant<PropValue>({ t: "date", v: "2026-09-24" }),
  fc.constantFrom<PropValue>({ t: "ref", v: TARGET }, { t: "ref", v: "n.missing" }),
);

const typeArb = fc.option(fc.constantFrom(...FIELD_TYPES), { nil: null });

/** Whether `value` may be held by a field declared `type` (null: undeclared). */
function expectedOk(type: FieldType | null, value: PropValue): boolean {
  if (!acceptsValueKind(type ?? "text", value)) return false;
  return value.t !== "ref" || value.v === TARGET;
}

describe("written values conform to their field", () => {
  test("a new value is accepted exactly when its field's type accepts it and a ref names a stored node", () => {
    fc.assert(
      fc.property(typeArb, valueArb, (type, value) => {
        const base = [field("f", type), node(TARGET)];
        const err = txIntegrityError(base, {
          upserts: [node("n.a", { f: [value] })],
          deletes: [],
        });
        expect(err === null).toBe(expectedOk(type, value));
      }),
    );
  });

  test("a value the stored node already held is carried, not rechecked", () => {
    fc.assert(
      fc.property(typeArb, valueArb, (type, value) => {
        const holder = node("n.a", { f: [value] });
        const base = [field("f", type), node(TARGET), holder];
        const renamed = { ...holder, text: "renamed" };
        expect(txIntegrityError(base, { upserts: [renamed], deletes: [] })).toBeNull();
      }),
    );
  });

  test("the field and the ref target may arrive in the same transaction", () => {
    const tx = {
      upserts: [field("f", "ref"), node("n.new"), node("n.a", { f: [{ t: "ref", v: "n.new" }] })],
      deletes: [],
    };
    // Over the seed: writing a field node writes its own sys.f.fieldType value.
    expect(txIntegrityError(systemSeedNodes(AT), tx)).toBeNull();
  });

  test("a ref to a node the same transaction deletes is refused", () => {
    const base = [field("f", "ref"), node(TARGET)];
    const err = txIntegrityError(base, {
      upserts: [node("n.a", { f: [{ t: "ref", v: TARGET }] })],
      deletes: [TARGET],
    });
    expect(err).toContain(`refs missing node ${TARGET}`);
  });

  test("the refusal names the node, the field and its type", () => {
    const base = [field("f.estimate", "number")];
    const err = txIntegrityError(base, {
      upserts: [node("n.a", { "f.estimate": [{ t: "str", v: "banana" }] })],
      deletes: [],
    });
    expect(err).toBe(
      'node n.a: field f.estimate is number and cannot hold {"t":"str","v":"banana"}',
    );
  });

  test("every value the seed writes conforms to the field it is under", () => {
    const seed = systemSeedNodes(AT);
    const byId = new Map(seed.map((n) => [n.id, n]));
    const failures = seed.flatMap((n) =>
      Object.entries(n.props).flatMap(([fieldId, values]) =>
        values.flatMap((value) => {
          const err = valueConformanceError(fieldId, value, byId);
          return err === null ? [] : [`${n.id}: ${err}`];
        }),
      ),
    );
    expect(failures).toEqual([]);
    expect(txIntegrityError([], { upserts: seed, deletes: [] })).toBeNull();
  });
});
