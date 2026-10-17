/**
 * A typed relation is a ref field: its field node's text is the label, and
 * `sys.f.relation.inverse` on that node, plain text, is what the relation is
 * called read against its direction ("influenced by" for "influences"). No
 * inverse edge is ever written; every reader that words a relation from its
 * target's side reads the inverse here.
 */
import { SYSTEM_IDS, type NodeId, type PropValue } from "./model.ts";

/** A field node's inverse label, or null when it names none. */
export function relationInverseOf(
  fieldNode: { readonly props: Readonly<Record<NodeId, readonly PropValue[]>> } | undefined,
): string | null {
  const inverse = fieldNode?.props[SYSTEM_IDS.relationInverseField]
    ?.find((value) => value.t === "str")
    ?.v.trim();
  return inverse === undefined || inverse === "" ? null : inverse;
}
