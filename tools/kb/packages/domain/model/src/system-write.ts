/**
 * Which writes to a system node are a person's to make (DESIGN.md → Data
 * model → write protection, Extension families → configuration).
 *
 * A `sys.*` node is seeded and code reads its shape, so it is written only
 * with `force`, with one exception the graph itself declares: a field node
 * that carries `sys.f.configures`, a ref to an extension's node, is a
 * setting of that extension, and its values on that node are written like
 * any field's values on any node. Nothing else of a system node is: not its
 * text, its children, its rank, nor a field that does not configure it,
 * the extension's switch (`sys.f.extension.enabled`, whose one writer is
 * `extension.switch`) included.
 *
 * One statement for every surface. The invoke core refuses a commit that
 * breaks it (`assertSystemWrites` in `@kb/operations`), on the server and on
 * the page's replica alike, and the page's field rows read
 * {@link isWritableField} to offer an edit only where the write would land.
 */
import { SYSTEM_IDS, isSysPrefixed, type KbNode, type NodeId } from "./model.ts";
import { refValuesOf, type NodeLike } from "./ontology.ts";

/** How a write finds the nodes it is checked against: the graph before it. */
export type NodeOf = (id: NodeId) => Pick<NodeLike, "props"> | undefined;

/** The extension's node a field configures (`sys.f.configures`), or null. */
export function configuredBy(fieldNode: Pick<NodeLike, "props"> | undefined): NodeId | null {
  return refValuesOf(fieldNode, SYSTEM_IDS.configuresField)[0] ?? null;
}

/**
 * Whether a person may write values of `fieldNode`'s field on `nodeId`
 * without force: on any node that is not a system node, and on a system
 * node only where the field configures that very node.
 */
export function isWritableField(
  nodeId: NodeId,
  fieldNode: Pick<NodeLike, "props"> | undefined,
): boolean {
  return !isSysPrefixed(nodeId) || configuredBy(fieldNode) === nodeId;
}

function sameValues(
  a: KbNode["props"][string] | undefined,
  b: KbNode["props"][string] | undefined,
) {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

/**
 * Why writing `next` over `before` (the node as the graph holds it now,
 * absent for a new one) is not a person's to make without force, or null
 * when it is. A node that is not a system node is always theirs. A system
 * node may change only in the values of fields that configure it, as
 * `fieldOf` reads those fields; minting one is never a person's write.
 */
export function systemWriteRefusal(
  before: KbNode | undefined,
  next: KbNode,
  fieldOf: NodeOf,
): string | null {
  if (!isSysPrefixed(next.id)) return null;
  const protectedWrite = `sys.* nodes are write-protected (use force to override): ${next.id}`;
  if (before === undefined) return protectedWrite;
  if (
    before.text !== next.text ||
    before.order !== next.order ||
    before.createdAt !== next.createdAt ||
    JSON.stringify(before.children) !== JSON.stringify(next.children)
  ) {
    return protectedWrite;
  }
  const fields = new Set([...Object.keys(before.props), ...Object.keys(next.props)]);
  for (const field of fields) {
    if (sameValues(before.props[field], next.props[field])) continue;
    if (!isWritableField(next.id, fieldOf(field))) return protectedWrite;
  }
  return null;
}
