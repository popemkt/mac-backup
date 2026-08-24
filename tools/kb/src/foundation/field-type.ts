/**
 * Field types, as nodes.
 *
 * A field whose value comes from a fixed list is an ordinary ref field pointing
 * at nodes that carry the list's tag. The type slot itself is that pattern:
 * `sys.f.fieldType` is a ref field constrained to `#field-type` nodes, so the
 * normal ref editor renders it and a user's own option list behaves the same
 * way — add an option by adding a node.
 *
 * This is the single source for the mapping. It used to exist three times: an
 * enum in the CLI mapper, a string-literal union in the UI, and the seed's
 * hardcoded prop values. The UI reads it through the `@kb/field-type` alias.
 */
import { SYSTEM_IDS, type PropValue } from "./model.ts";

/** Declared type → option node id. */
export const FIELD_TYPE_OPTION_IDS = {
  text: SYSTEM_IDS.ftText,
  number: SYSTEM_IDS.ftNumber,
  date: SYSTEM_IDS.ftDate,
  url: SYSTEM_IDS.ftUrl,
  checkbox: SYSTEM_IDS.ftCheckbox,
  ref: SYSTEM_IDS.ftRef,
} as const;

export type FieldType = keyof typeof FIELD_TYPE_OPTION_IDS;

export const FIELD_TYPES = Object.keys(FIELD_TYPE_OPTION_IDS) as FieldType[];

/** Option node id → declared type. */
export const FIELD_TYPE_BY_OPTION_ID: Record<string, FieldType> =
  Object.fromEntries(
    FIELD_TYPES.map((type) => [FIELD_TYPE_OPTION_IDS[type], type]),
  );

export function isFieldType(value: unknown): value is FieldType {
  // `Object.hasOwn`, not `in`: `in` also matches inherited names like
  // `__proto__`, `toString`, or `constructor`, which are not own keys of
  // FIELD_TYPE_OPTION_IDS but would otherwise pass as a "known" field type.
  return typeof value === "string" && Object.hasOwn(FIELD_TYPE_OPTION_IDS, value);
}

/** The value written into a field node's type slot. */
export function fieldTypeValue(type: FieldType): PropValue {
  return { t: "ref", v: FIELD_TYPE_OPTION_IDS[type] };
}

/**
 * Read a declared type off a field node's props. Absent ⇒ text.
 *
 * Stores written before field types became nodes hold `{t:"str", v:"number"}`,
 * so that form still reads — there is no migration to run and no second code
 * path downstream, because both collapse to the same FieldType here.
 */
export function fieldTypeOf(
  props: Record<string, readonly PropValue[]> | undefined,
): FieldType {
  const raw = props?.[SYSTEM_IDS.fieldTypeField]?.[0];
  if (!raw) return "text";
  if (raw.t === "ref") return FIELD_TYPE_BY_OPTION_ID[String(raw.v)] ?? "text";
  if (raw.t === "str" && isFieldType(raw.v)) return raw.v;
  return "text";
}

/**
 * Rewrite pre-option-node type values to refs.
 *
 * `fieldTypeOf` reads the old `{t:"str", v:"number"}` form, so nothing is
 * broken without this — but leaving two representations in the store means the
 * ordinary ref editor renders a stored string as *unset*, which looks like data
 * loss. Migrating on open keeps one representation in the store and one editor,
 * rather than teaching the editor a second form it would carry forever.
 */
export function migrateFieldTypeValues<
  T extends { props: Record<string, PropValue[]> },
>(nodes: T[]): { nodes: T[]; changed: boolean } {
  let changed = false;
  const out = nodes.map((node) => {
    const values = node.props[SYSTEM_IDS.fieldTypeField];
    if (!values?.some((v) => v.t === "str" && isFieldType(v.v))) return node;
    const next = values.map((v) =>
      v.t === "str" && isFieldType(v.v) ? fieldTypeValue(v.v) : v,
    );
    changed = true;
    return {
      ...node,
      props: { ...node.props, [SYSTEM_IDS.fieldTypeField]: next },
    };
  });
  return { nodes: changed ? out : nodes, changed };
}
