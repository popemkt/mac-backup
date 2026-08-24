import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { SYSTEM_IDS, type PropValue } from "../src/foundation/model.ts";
import {
  FIELD_TYPES,
  fieldTypeOf,
  fieldTypeValue,
  isFieldType,
  type FieldType,
} from "../src/foundation/field-type.ts";
import { migrateFieldTypeValues } from "../src/foundation/field-type.ts";

/** Any PropValue, including refs/strings unrelated to field types — noise. */
const propValueArb: fc.Arbitrary<PropValue> = fc.oneof(
  fc.record({ t: fc.constant("str" as const), v: fc.string() }),
  fc.record({ t: fc.constant("num" as const), v: fc.double({ noNaN: true }) }),
  fc.record({ t: fc.constant("bool" as const), v: fc.boolean() }),
  fc.record({ t: fc.constant("date" as const), v: fc.string() }),
  fc.record({ t: fc.constant("ref" as const), v: fc.string() }),
);

const fieldTypeArb: fc.Arbitrary<FieldType> = fc.constantFrom(...FIELD_TYPES);

describe("field-type properties (fast-check)", () => {
  test("fieldTypeOf(fieldTypeValue(t)) round-trips for every FieldType, regardless of surrounding props", () => {
    fc.assert(
      fc.property(
        fieldTypeArb,
        fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.array(propValueArb)),
        (t, noiseProps) => {
          const props = {
            ...noiseProps,
            [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue(t)],
          };
          expect(fieldTypeOf(props)).toBe(t);
        },
      ),
      { numRuns: 500 },
    );
  });

  test("fieldTypeOf reads the legacy string form identically to the ref form", () => {
    fc.assert(
      fc.property(fieldTypeArb, (t) => {
        const refForm = { [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue(t)] };
        const legacyForm = {
          [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: t } as PropValue],
        };
        expect(fieldTypeOf(legacyForm)).toBe(fieldTypeOf(refForm));
        expect(fieldTypeOf(legacyForm)).toBe(t);
      }),
      { numRuns: 500 },
    );
  });

  test("fieldTypeOf defaults to text for absent, unknown, or malformed values", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.record({
            t: fc.constant("str" as const),
            // Exclude the known type names directly (not via `isFieldType`,
            // which this property must stay independent of — filtering
            // through the function under test risks masking a mutation to
            // it, and fast-check's rejection-sampling can stall badly if the
            // predicate the filter calls is itself broken).
            v: fc
              .string()
              .filter((s) => !(FIELD_TYPES as readonly string[]).includes(s)),
          }),
          fc.record({ t: fc.constant("num" as const), v: fc.double({ noNaN: true }) }),
          fc.record({ t: fc.constant("bool" as const), v: fc.boolean() }),
        ),
        (raw) => {
          const props: Record<string, PropValue[]> =
            raw === undefined
              ? {}
              : { [SYSTEM_IDS.fieldTypeField]: [raw as PropValue] };
          expect(fieldTypeOf(props)).toBe("text");
        },
      ),
      { numRuns: 500 },
    );
  });

  const nodeArb = fc.record({
    id: fc.stringMatching(/^n[a-z0-9]{1,8}$/),
    text: fc.string(),
    props: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 10 }),
      fc.array(propValueArb, { minLength: 0, maxLength: 3 }),
    ),
  });

  test("migrateFieldTypeValues is idempotent and never touches a node with no legacy string form", () => {
    fc.assert(
      fc.property(fc.array(nodeArb, { minLength: 0, maxLength: 20 }), (rawNodes) => {
        const nodes = rawNodes.map((n) => ({ ...n, props: { ...n.props } }));
        const first = migrateFieldTypeValues(nodes);
        const second = migrateFieldTypeValues(first.nodes);

        // Idempotent: a second pass reports no further change and produces
        // byte-for-byte the same node set.
        expect(second.changed).toBe(false);
        expect(second.nodes).toEqual(first.nodes);

        // A node with no legacy string form at the type field is returned
        // untouched (same reference) by the first pass too.
        nodes.forEach((original, i) => {
          const values = original.props[SYSTEM_IDS.fieldTypeField];
          const hasLegacy = values?.some((v) => v.t === "str" && isFieldType(v.v));
          if (!hasLegacy) expect(first.nodes[i]).toBe(original);
        });
      }),
      { numRuns: 500 },
    );
  });

  test("migrateFieldTypeValues rewrites every legacy string form to a ref, preserving the declared type", () => {
    fc.assert(
      fc.property(
        fieldTypeArb,
        fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.array(propValueArb, { maxLength: 2 })),
        (t, otherProps) => {
          const node = {
            id: "n1",
            text: "x",
            props: {
              ...otherProps,
              [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: t } as PropValue],
            },
          };
          const { nodes, changed } = migrateFieldTypeValues([node]);
          expect(changed).toBe(true);
          const migrated = nodes[0]!.props[SYSTEM_IDS.fieldTypeField]![0]!;
          expect(migrated).toEqual(fieldTypeValue(t));
          expect(fieldTypeOf(nodes[0]!.props)).toBe(t);
        },
      ),
      { numRuns: 500 },
    );
  });

  test("in a multi-valued fieldTypeField, only the legacy string entries are rewritten — an already-migrated ref entry is left alone", () => {
    fc.assert(
      fc.property(fieldTypeArb, fieldTypeArb, (legacyType, refType) => {
        // One legacy string form and one already-migrated ref form, sharing
        // the same (multi-valued) field key — `.some(...)` must still catch
        // the legacy one even though not *every* entry qualifies, and the
        // ref entry must be untouched by the rewrite.
        const node = {
          id: "n1",
          text: "x",
          props: {
            [SYSTEM_IDS.fieldTypeField]: [
              { t: "str", v: legacyType } as PropValue,
              fieldTypeValue(refType),
            ],
          },
        };
        const { nodes, changed } = migrateFieldTypeValues([node]);
        expect(changed).toBe(true);
        const values = nodes[0]!.props[SYSTEM_IDS.fieldTypeField]!;
        expect(values[0]).toEqual(fieldTypeValue(legacyType));
        expect(values[1]).toEqual(fieldTypeValue(refType));

        expect(migrateFieldTypeValues(nodes).changed).toBe(false);
      }),
      { numRuns: 500 },
    );
  });
});
