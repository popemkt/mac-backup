/**
 * A typed relation is a ref field: its field node's text is the label, and
 * `sys.f.relation.inverse` on that node, plain text, is what the relation is
 * called read against its direction ("influenced by" for "influences"). No
 * inverse edge is ever written; every reader that words a relation from its
 * target's side reads the inverse here.
 *
 * Which fields can type a relation to a target is answered here once
 * (`relationFieldFit`): what a picker offers (`relationFieldsFor`) and what
 * every relation write accepts (`graph.relation.type`, a canvas edge's native
 * bind) are both read through it, so nothing is offered that a write refuses.
 */
import { allowedRefIdsOf, fieldTypeOf } from "./field-type.ts";
import { isSysPrefixed, SYSTEM_IDS, type NodeId, type PropValue } from "./model.ts";
import { typeRefsOf, type NodeLike } from "./ontology.ts";

/** A field node's inverse label, or null when it names none. */
export function relationInverseOf(
  fieldNode: { readonly props: Readonly<Record<NodeId, readonly PropValue[]>> } | undefined,
): string | null {
  const inverse = fieldNode?.props[SYSTEM_IDS.relationInverseField]
    ?.find((value) => value.t === "str")
    ?.v.trim();
  return inverse === undefined || inverse === "" ? null : inverse;
}

/**
 * Whether `fieldNode` can type a relation to `target`, or why not: it must be
 * a field node, a person's own (not a system one), a ref field, and allow the
 * target by the one resolver every ref slot reads (`allowedRefIdsOf`).
 */
export type RelationFieldFit = "fits" | "not-field" | "system" | "not-ref" | "not-allowed";

export function relationFieldFit(
  fieldNode: NodeLike,
  target: NodeId,
  nodes: ReadonlyMap<NodeId, NodeLike>,
  runQuery: ((edn: string) => unknown[][]) | null,
): RelationFieldFit {
  if (!typeRefsOf(fieldNode).includes(SYSTEM_IDS.field)) return "not-field";
  if (isSysPrefixed(fieldNode.id)) return "system";
  if (fieldTypeOf(fieldNode.props) !== "ref") return "not-ref";
  const allowed = allowedRefIdsOf(fieldNode, nodes, runQuery);
  return allowed === null || allowed.has(target) ? "fits" : "not-allowed";
}

/** Why a field types no relation to a target, in words, by what `relationFieldFit` found. */
const MISFITS: {
  readonly [F in Exclude<RelationFieldFit, "fits">]: (field: NodeId, target: NodeId) => string;
} = {
  "not-field": (field) => `${field} is not a field, so it types no relation`,
  system: (field) => `${field} is kb's own field; a relation is typed as one of yours`,
  "not-ref": (field) => `${field} is not a ref field, so it types no relation`,
  "not-allowed": (field, target) => `${field} does not allow ${target} as a target`,
};

/** What every relation write refuses `field` for, said once. */
export function relationMisfit(
  fit: Exclude<RelationFieldFit, "fits">,
  field: NodeId,
  target: NodeId,
): string {
  return MISFITS[fit](field, target);
}

/**
 * The fields a relation to `target` can be typed as: every node
 * `relationFieldFit` says fits, by text. What a "Link as…" picker and a
 * canvas edge's field menu offer.
 */
export function relationFieldsFor<N extends NodeLike>(
  nodes: ReadonlyMap<NodeId, N>,
  target: NodeId,
  runQuery: ((edn: string) => unknown[][]) | null,
): N[] {
  return [...nodes.values()]
    .filter((node) => relationFieldFit(node, target, nodes, runQuery) === "fits")
    .toSorted((a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id));
}
