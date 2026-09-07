/**
 * Declared field types (Tana fieldType pattern) — the browser side.
 *
 * What a field node *declares* (its type, and for ref fields its allowed
 * targets) is shared with core through `@kb/field-type`: restating any of it
 * here is how the CLI mapper, the seed, and this file drifted into three copies
 * of one enum, and how allowed-ref resolution ended up reading the outline's
 * `#tag` badge array — a display artifact — as if it were the graph.
 *
 * What stays local is only what the browser adds: binding DataScript as the EDN
 * runner core asks for, memoizing the result per snapshot, mismatch hints, and
 * the empty value a typed editor starts from.
 */
import {
  FIELD_TYPES,
  FIELD_TYPE_OPTION_IDS,
  allowedRefIdsOf,
  fieldTypeOf,
  fieldTypeValue,
  isFieldType,
  targetQueryOf,
  targetTagsOf,
  type FieldType,
} from "@kb/model";
import { hasText } from "@/lib/text";
import { runQuery, type KbIndex } from "@/ds";
import type { NodeMap, OutlineNode, PropValue } from "@/lib/types";

export { FIELD_TYPES, FIELD_TYPE_OPTION_IDS, fieldTypeValue, isFieldType, type FieldType };

/** Read declared type from a field definition node; default text. */
export function resolveFieldType(fieldNode: OutlineNode | undefined): FieldType {
  return fieldTypeOf(fieldNode?.props);
}

export function resolveFieldTypeById(fieldId: string, nodes: NodeMap): FieldType {
  return resolveFieldType(nodes.get(fieldId));
}

/**
 * Allowed ref target ids for a field — the browser binding of
 * `@kb/field-type`'s resolver, with DataScript supplied as its EDN runner.
 *
 * There is no logic here on purpose. Resolution answers "what does this field
 * node declare", which is a question about the graph, so it is owned by core
 * and shared verbatim with the CLI and MCP. Deciding which of the answers a
 * picker should *show* is the separate, display-side question, and it is
 * answered once in `fuzzyNodeCandidates` (lib/refs), which takes this set as an
 * input.
 */
export function resolveAllowedRefIds(
  fieldNode: OutlineNode | undefined,
  nodes: NodeMap,
  queryDb: KbIndex | null,
): Set<string> | null {
  return allowedRefIdsOf(fieldNode, nodes, queryDb ? (edn) => runQuery(queryDb, edn) : null);
}

/** Cache keyed by fieldId + index generation + constraint fingerprint (EDN / tags). */
const allowedRefCache = new Map<string, Set<string> | null>();
let allowedRefCacheGeneration = -1;

function constraintFingerprint(fieldNode: OutlineNode | undefined): string {
  const edn = targetQueryOf(fieldNode);
  if (hasText(edn)) return `q:${edn}`;
  const tags = targetTagsOf(fieldNode);
  if (tags.length > 0) return `t:${tags.slice().toSorted().join(",")}`;
  // Third carrier: the field's own children are its option set, so the child
  // list is the constraint and belongs in the key like the other two.
  const children = fieldNode?.children ?? [];
  if (children.length === 0) return "open";
  return `c:${children.join(",")}`;
}

/**
 * Memoized allowed-ref set. Recomputes only when the index generation or the
 * field's targetQuery/targetTag constraint changes — not per React render/keystroke.
 */
export function resolveAllowedRefIdsCached(
  fieldId: string,
  fieldNode: OutlineNode | undefined,
  nodes: NodeMap,
  queryDb: KbIndex | null,
  generation: number,
): Set<string> | null {
  if (allowedRefCacheGeneration !== generation) {
    allowedRefCache.clear();
    allowedRefCacheGeneration = generation;
  }
  const key = `${fieldId}\0${constraintFingerprint(fieldNode)}`;
  const cached = allowedRefCache.get(key);
  if (cached !== undefined || allowedRefCache.has(key)) return cached ?? null;
  const value = resolveAllowedRefIds(fieldNode, nodes, queryDb);
  allowedRefCache.set(key, value);
  return value;
}

/** Test helper — drop memo between cases. */
export function clearAllowedRefIdsCache(): void {
  allowedRefCache.clear();
  allowedRefCacheGeneration = -1;
}

/**
 * What each declared field type is, as one table.
 *
 * The expected wire kind, the value an empty editor starts from, and which
 * wire kinds the type accepts without a mismatch hint were three `switch`
 * statements over the same union, kept in step by hand. They are three columns
 * of one row now, so a new field type is a row rather than three edits — and
 * the union's exhaustiveness is what fails the build when a row is missing,
 * where a `default:` used to swallow it.
 *
 * The *editor* for a type is not a column here: it is React, and this module
 * is read by code that has no DOM. `components/outline/field-value` keys the
 * editor registry by the same union.
 */
interface FieldTypeSpec {
  /** Wire `PropValue.t`, narrowed where the type constrains a string. */
  readonly wireKind: PropValue["t"] | "str-url" | "str-date";
  /** Wire kinds a value may carry without the UI hinting a mismatch. */
  readonly accepts: readonly PropValue["t"][];
  /** Starter value for an empty typed editor. */
  readonly empty: PropValue;
}

const FIELD_TYPE_SPEC: Record<FieldType, FieldTypeSpec> = {
  text: { wireKind: "str", accepts: ["str"], empty: { t: "str", v: "" } },
  number: { wireKind: "num", accepts: ["num"], empty: { t: "num", v: 0 } },
  // Prefer ISO str; legacy {t:date} is still accepted as matching.
  date: { wireKind: "str-date", accepts: ["str", "date"], empty: { t: "str", v: "" } },
  url: { wireKind: "str-url", accepts: ["str"], empty: { t: "str", v: "" } },
  checkbox: { wireKind: "bool", accepts: ["bool"], empty: { t: "bool", v: false } },
  ref: { wireKind: "ref", accepts: ["ref"], empty: { t: "ref", v: "" } },
};

/** Expected wire PropValue.t for a declared FieldType (url/date use str). */
export function expectedPropKind(fieldType: FieldType): PropValue["t"] | "str-url" | "str-date" {
  return FIELD_TYPE_SPEC[fieldType].wireKind;
}

/** Subtle UI mismatch — core writes stay permissive. */
export function isValueMismatch(fieldType: FieldType, value: PropValue): boolean {
  return !FIELD_TYPE_SPEC[fieldType].accepts.includes(value.t);
}

/** Empty / starter value for a typed editor. */
export function emptyValueForType(fieldType: FieldType): PropValue {
  return { ...FIELD_TYPE_SPEC[fieldType].empty };
}
