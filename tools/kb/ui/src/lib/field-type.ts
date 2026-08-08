/**
 * Declared field types (Tana fieldType pattern).
 * Absent sys.f.fieldType ⇒ text. Stored as {t:str} enum on the field node.
 */
import { runQuery } from "@/ds/query";
import type { QueryDb } from "@/ds/db";
import type { NodeMap, OutlineNode, PropValue } from "@/lib/types";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID } from "@/lib/types";

export const FIELD_TYPES = [
  "text",
  "number",
  "date",
  "url",
  "checkbox",
  "ref",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export function isFieldType(v: unknown): v is FieldType {
  return typeof v === "string" && (FIELD_TYPES as readonly string[]).includes(v);
}

/** Read declared type from a field definition node; default text. */
export function resolveFieldType(
  fieldNode: OutlineNode | undefined,
): FieldType {
  const raw = fieldNode?.props[SYSTEM_IDS.fieldTypeField]?.[0];
  if (raw?.t === "str" && isFieldType(raw.v)) return raw.v;
  return "text";
}

export function resolveFieldTypeById(
  fieldId: string,
  nodes: NodeMap,
): FieldType {
  return resolveFieldType(nodes.get(fieldId));
}

/** Target tag ids (union sugar) when fieldType=ref. */
export function resolveTargetTags(
  fieldNode: OutlineNode | undefined,
): string[] {
  if (!fieldNode) return [];
  return (fieldNode.props[SYSTEM_IDS.targetTagField] ?? [])
    .filter((v): v is Extract<PropValue, { t: "ref" }> => v.t === "ref")
    .map((v) => v.v);
}

/** Optional EDN constraint; when present, wins over targetTag. */
export function resolveTargetQuery(
  fieldNode: OutlineNode | undefined,
): string | null {
  const raw = fieldNode?.props[SYSTEM_IDS.targetQueryField]?.[0];
  if (raw?.t !== "str") return null;
  const edn = String(raw.v).trim();
  return edn || null;
}

/**
 * Allowed ref suggestion ids.
 * targetQuery present ⇒ query result set (tag ignored).
 * else targetTag ⇒ union of nodes tagged with any listed tag.
 * else ⇒ unrestricted (null).
 */
export function resolveAllowedRefIds(
  fieldNode: OutlineNode | undefined,
  nodes: NodeMap,
  queryDb: QueryDb | null,
): Set<string> | null {
  const edn = resolveTargetQuery(fieldNode);
  if (edn) {
    if (!queryDb) return new Set();
    try {
      const rows = runQuery(queryDb, edn);
      const ids = new Set<string>();
      for (const row of rows) {
        for (const cell of row) {
          if (typeof cell === "string" && nodes.has(cell)) ids.add(cell);
        }
      }
      return ids;
    } catch {
      return new Set();
    }
  }

  const tags = resolveTargetTags(fieldNode);
  if (tags.length === 0) return null;

  const allowed = new Set<string>();
  const tagSet = new Set(tags);
  for (const n of nodes.values()) {
    if (n.id === WORKSPACE_ROOT_ID || n.id.startsWith("sys.")) continue;
    if (n.tags.some((t) => tagSet.has(t.id))) allowed.add(n.id);
  }
  return allowed;
}

/** Cache keyed by fieldId + rev + constraint fingerprint (EDN / tags). */
const allowedRefCache = new Map<string, Set<string> | null>();
let allowedRefCacheRev = -1;

function constraintFingerprint(fieldNode: OutlineNode | undefined): string {
  const edn = resolveTargetQuery(fieldNode);
  if (edn) return `q:${edn}`;
  const tags = resolveTargetTags(fieldNode);
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
