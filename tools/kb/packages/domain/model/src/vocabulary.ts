import { SYSTEM_IDS, isSysPrefixed, type KbNode, type NodeId } from "./model.ts";
import { typeRefsOf } from "./ontology.ts";

/** Whether `node` defines a tag or a field. */
const definesKind = (node: Pick<KbNode, "props"> | undefined): boolean =>
  typeRefsOf(node).some((kind) => kind === SYSTEM_IDS.tag || kind === SYSTEM_IDS.field);

/**
 * Whether `id` is of the vocabulary nodes are written in, rather than a node
 * the graph is about: kb's own (`sys.*`), a tag or a field, or one of a
 * field's options — its children (DESIGN.md → Kinds, roles and options).
 * `nodeOf` reads a node, and `parentOf` the node it is under.
 */
export function isVocabulary(
  id: NodeId,
  nodeOf: (id: NodeId) => Pick<KbNode, "props"> | undefined,
  parentOf: (id: NodeId) => NodeId | undefined,
): boolean {
  if (isSysPrefixed(id) || definesKind(nodeOf(id))) return true;
  const parent = parentOf(id);
  return parent !== undefined && typeRefsOf(nodeOf(parent)).includes(SYSTEM_IDS.field);
}
