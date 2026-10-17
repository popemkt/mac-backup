/**
 * A typed relation is a ref field: its field node's text is the label, and
 * `sys.f.relation.inverse` on that node, plain text, is what the relation is
 * called read against its direction ("influenced by" for "influences"). No
 * inverse edge is ever written; every reader that words a relation from its
 * target's side reads the inverse here.
 *
 * Which fields can type a relation to a target is answered here once
 * (`relationFieldFit`), and what a picker offers (`relationFieldsFor`) is
 * read through it.
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
 * a ref field, and allow the target by the one resolver every ref slot reads
 * (`allowedRefIdsOf`).
 */
export type RelationFieldFit = "fits" | "not-ref" | "not-allowed";

export function relationFieldFit(
  fieldNode: NodeLike,
  target: NodeId,
  nodes: ReadonlyMap<NodeId, NodeLike>,
  runQuery: ((edn: string) => unknown[][]) | null,
): RelationFieldFit {
  if (fieldTypeOf(fieldNode.props) !== "ref") return "not-ref";
  const allowed = allowedRefIdsOf(fieldNode, nodes, runQuery);
  return allowed === null || allowed.has(target) ? "fits" : "not-allowed";
}

/**
 * The fields a person may type a relation to `target` as: every ref field
 * of theirs (not a system one) that allows it, by text. What a "Link as…"
 * picker offers, held to the rule a typed relation is written by.
 */
export function relationFieldsFor<N extends NodeLike>(
  nodes: ReadonlyMap<NodeId, N>,
  target: NodeId,
  runQuery: ((edn: string) => unknown[][]) | null,
): N[] {
  return [...nodes.values()]
    .filter(
      (node) =>
        !isSysPrefixed(node.id) &&
        typeRefsOf(node).includes(SYSTEM_IDS.field) &&
        relationFieldFit(node, target, nodes, runQuery) === "fits",
    )
    .toSorted((a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id));
}
