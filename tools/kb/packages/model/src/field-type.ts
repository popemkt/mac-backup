/**
 * What a field node declares: its value type, and — for ref fields — which
 * nodes are allowed as values.
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
 *
 * Target-constraint resolution lives here for the same reason, and it moved
 * here from the browser: it is *resolution*, not display. While it sat in the
 * UI it could reach for a display-shaped list (the `#tag` badge array) and
 * did — so `targetTag → sys.tag` resolved to nothing. This module is pure and
 * isomorphic (no DOM, no datascript; the EDN runner is injected, exactly as in
 * `ontology.ts`), and its node shape carries no badges at all, so that class of
 * leak is not expressible here.
 */
import { SYSTEM_IDS, type NodeId, type PropValue } from "./model.ts";
import { refValuesOf, strValueOf, typeRefsOf, type NodeLike } from "./ontology.ts";

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

/**
 * Declared order for CLI help and the seeded option nodes. Written out rather
 * than read back from `Object.keys`, which erases the literal types.
 */
export const FIELD_TYPES: readonly FieldType[] = [
  "text",
  "number",
  "date",
  "url",
  "checkbox",
  "ref",
];

/** Option node id → declared type. */
const FIELD_TYPE_BY_OPTION_ID: Record<string, FieldType> = Object.fromEntries(
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
export function fieldTypeOf(props: Record<string, readonly PropValue[]> | undefined): FieldType {
  const raw = props?.[SYSTEM_IDS.fieldTypeField]?.[0];
  if (!raw) return "text";
  if (raw.t === "ref") return FIELD_TYPE_BY_OPTION_ID[raw.v] ?? "text";
  if (raw.t === "str" && isFieldType(raw.v)) return raw.v;
  return "text";
}

// ── ref target constraints ─────────────────────────────────────────────────

/** Target tag ids a ref field declares (`sys.f.targetTag`, multi = union). */
export function targetTagsOf(fieldNode: NodeLike | undefined): NodeId[] {
  return refValuesOf(fieldNode, SYSTEM_IDS.targetTagField);
}

/**
 * The EDN constraint a ref field declares (`sys.f.targetQuery`), or null.
 * Present ⇒ it wins over `targetTag`: the query is the general form and the
 * tag is sugar for one shape of it, so honouring both would mean two answers
 * to one question.
 */
export function targetQueryOf(fieldNode: NodeLike | undefined): string | null {
  return strValueOf(fieldNode, SYSTEM_IDS.targetQueryField);
}

/**
 * Allowed ref target ids — what the *field node declares*, nothing else.
 *
 *   targetQuery present ⇒ the query's row ids (targetTag ignored)
 *   else targetTag      ⇒ union of nodes whose `sys.f.type` names a listed tag
 *   else               ⇒ unrestricted (null)
 *
 * This is data, not display policy. No node is dropped for being seeded or
 * `sys.`-prefixed: `sys.f.fieldType` legitimately targets six `sys.ft.*`
 * options, and `sys.f.onto.include` legitimately targets every supertag,
 * `sys.tag.*` ones included. Which of these a picker chooses to *show* is a
 * separate decision, made once in the UI's `fuzzyNodeCandidates`, which takes
 * this set as an input.
 *
 * `nodes` is typed as a map of {@link NodeLike} on purpose — a map, so the UI
 * can pass its live node map without copying, and `NodeLike`, so nothing in
 * here can see a rendered badge list even if someone tries.
 *
 * `runQuery` is the injected EDN runner (CLI/MCP: `foundation/query`; browser:
 * `ds/query`). A declared query with no runner, or one that throws, yields the
 * empty set rather than silently widening to "everything is allowed".
 */
export function allowedRefIdsOf(
  fieldNode: NodeLike | undefined,
  nodes: ReadonlyMap<NodeId, NodeLike>,
  runQuery?: ((edn: string) => unknown[][]) | null,
): Set<NodeId> | null {
  const edn = targetQueryOf(fieldNode);
  if (typeof edn === "string" && edn !== "") {
    if (runQuery === undefined || runQuery === null) return new Set();
    try {
      const ids = new Set<NodeId>();
      for (const row of runQuery(edn)) {
        for (const cell of Array.isArray(row) ? row : [row]) {
          if (typeof cell === "string" && nodes.has(cell)) ids.add(cell);
        }
      }
      return ids;
    } catch {
      return new Set();
    }
  }

  const tags = targetTagsOf(fieldNode);
  if (tags.length === 0) return null;

  const tagSet = new Set(tags);
  const allowed = new Set<NodeId>();
  for (const node of nodes.values()) {
    if (typeRefsOf(node).some((t) => tagSet.has(t))) allowed.add(node.id);
  }
  return allowed;
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
export function migrateFieldTypeValues<T extends { props: Record<string, PropValue[]> }>(
  nodes: T[],
): { nodes: T[]; changed: boolean } {
  let changed = false;
  const out: T[] = [];
  for (const node of nodes) {
    const values = node.props[SYSTEM_IDS.fieldTypeField];
    if (values === undefined || !values.some((v) => v.t === "str" && isFieldType(v.v))) {
      out.push(node);
      continue;
    }
    const next = values.map((v) => (v.t === "str" && isFieldType(v.v) ? fieldTypeValue(v.v) : v));
    changed = true;
    out.push({
      ...node,
      props: { ...node.props, [SYSTEM_IDS.fieldTypeField]: next },
    });
  }
  return { nodes: changed ? out : nodes, changed };
}
