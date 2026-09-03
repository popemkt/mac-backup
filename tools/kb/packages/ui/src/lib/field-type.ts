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
import { runQuery } from "@/ds/query";
import type { QueryDb } from "@/ds/db";
import type { NodeMap, OutlineNode, PropValue } from "@/lib/types";

export {
  FIELD_TYPES,
  FIELD_TYPE_OPTION_IDS,
  fieldTypeValue,
  isFieldType,
  type FieldType,
};

/** Read declared type from a field definition node; default text. */
export function resolveFieldType(
  fieldNode: OutlineNode | undefined,
): FieldType {
  return fieldTypeOf(fieldNode?.props);
}

export function resolveFieldTypeById(
  fieldId: string,
  nodes: NodeMap,
): FieldType {
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
  queryDb: QueryDb | null,
): Set<string> | null {
  return allowedRefIdsOf(
    fieldNode,
    nodes,
    queryDb ? (edn) => runQuery(queryDb, edn) : null,
  );
}

/** Cache keyed by fieldId + rev + constraint fingerprint (EDN / tags). */
const allowedRefCache = new Map<string, Set<string> | null>();
let allowedRefCacheRev = -1;

function constraintFingerprint(fieldNode: OutlineNode | undefined): string {
  const edn = targetQueryOf(fieldNode);
  if (edn) return `q:${edn}`;
  const tags = targetTagsOf(fieldNode);
  if (tags.length === 0) return "open";
  return `t:${tags.slice().sort().join(",")}`;
}

/**
 * Memoized allowed-ref set. Recomputes only when rev or the field's
 * targetQuery/targetTag constraint changes — not per React render/keystroke.
 */
export function resolveAllowedRefIdsCached(
  fieldId: string,
  fieldNode: OutlineNode | undefined,
  nodes: NodeMap,
  queryDb: QueryDb | null,
  rev: number,
): Set<string> | null {
  if (allowedRefCacheRev !== rev) {
    allowedRefCache.clear();
    allowedRefCacheRev = rev;
  }
  const key = `${fieldId}\0${constraintFingerprint(fieldNode)}`;
  if (allowedRefCache.has(key)) return allowedRefCache.get(key)!;
  const value = resolveAllowedRefIds(fieldNode, nodes, queryDb);
  allowedRefCache.set(key, value);
  return value;
}

/** Test helper — drop memo between cases. */
export function clearAllowedRefIdsCache(): void {
  allowedRefCache.clear();
  allowedRefCacheRev = -1;
}

/** Expected wire PropValue.t for a declared FieldType (url/date use str). */
export function expectedPropKind(
  fieldType: FieldType,
): PropValue["t"] | "str-url" | "str-date" {
  switch (fieldType) {
    case "number":
      return "num";
    case "checkbox":
      return "bool";
    case "ref":
      return "ref";
    case "date":
      return "str-date";
    case "url":
      return "str-url";
    case "text":
    default:
      return "str";
  }
}

/** Subtle UI mismatch — core writes stay permissive. */
export function isValueMismatch(
  fieldType: FieldType,
  value: PropValue,
): boolean {
  switch (fieldType) {
    case "number":
      return value.t !== "num";
    case "checkbox":
      return value.t !== "bool";
    case "ref":
      return value.t !== "ref";
    case "date":
      // Prefer ISO str; legacy {t:date} is still accepted as matching.
      return value.t !== "str" && value.t !== "date";
    case "url":
      return value.t !== "str";
    case "text":
      return value.t !== "str";
    default:
      return false;
  }
}

/** Empty / starter value for a typed editor. */
export function emptyValueForType(fieldType: FieldType): PropValue {
  switch (fieldType) {
    case "number":
      return { t: "num", v: 0 };
    case "checkbox":
      return { t: "bool", v: false };
    case "ref":
      return { t: "ref", v: "" };
    case "date":
    case "url":
    case "text":
    default:
      return { t: "str", v: "" };
  }
}

/** Map FieldType → FieldRow icon key (legacy PropValue.t icons reused). */
export function fieldTypeIconKind(
  fieldType: FieldType,
): PropValue["t"] {
  switch (fieldType) {
    case "number":
      return "num";
    case "checkbox":
      return "bool";
    case "ref":
      return "ref";
    case "date":
      return "date";
    case "url":
      return "str";
    case "text":
    default:
      return "str";
  }
}
