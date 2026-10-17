/**
 * Which writes to a system node are a person's to make (DESIGN.md → Data
 * model → write protection, Extension families → configuration).
 *
 * A `sys.*` node is seeded and code reads its shape, so it is written only
 * with `force`, with one exception the graph itself declares: a system field
 * that carries `sys.f.configures`, a ref to an extension's node (or to their
 * list, `sys.extensions`, for every one of them), is a setting of that
 * extension, and its values on that node are written like any field's
 * values on any node. The field must itself be a system field: only the
 * owner's `force` mints or retargets one, so a field anyone may add cannot
 * declare itself a setting of a node it does not own. Nothing else of a
 * system node is a person's to write: not its text, its children, its rank,
 * nor a field that does not configure it. The switch
 * (`sys.f.extension.enabled`, which configures every extension's node) is a
 * setting like any other, and `extension.switch` writes it through the same
 * rule.
 *
 * One statement for every surface. The commit refuses a transaction that
 * breaks it ({@link systemTxRefusal}, read by `persistEffect` in
 * `@kb/operations`, its one owner), on the server and on the page's replica
 * alike, and the page's field rows read {@link isWritableField} to offer an
 * edit only where the write would land.
 */
import { SYSTEM_IDS, isExtensionNodeId, isSysPrefixed, type KbNode, type NodeId } from "./model.ts";
import type { NodeWrite } from "./approval-policy.ts";
import { refValuesOf, typeRefsOf, type NodeLike } from "./ontology.ts";

/** How a write finds the nodes it is checked against: the graph before it. */
export type NodeOf = (id: NodeId) => Pick<NodeLike, "props"> | undefined;

/**
 * Whether the field `fieldId` (its node `fieldNode`) is a setting of
 * `nodeId`: a system field whose `sys.f.configures` names that node, or
 * names `sys.extensions` where the node is an extension's.
 */
export function configures(
  fieldId: NodeId,
  fieldNode: Pick<NodeLike, "props"> | undefined,
  nodeId: NodeId,
): boolean {
  if (!isSysPrefixed(fieldId)) return false;
  const named = refValuesOf(fieldNode, SYSTEM_IDS.configuresField);
  return named.some((target) =>
    target === SYSTEM_IDS.extensionsRoot ? isExtensionNodeId(nodeId) : target === nodeId,
  );
}

/**
 * Whether the system node `id` (its node `node`) configures an extension:
 * its `sys.f.configures` names an extension's node or their list. A field
 * that does is a setting; a tag that does is a kind whose nodes are that
 * extension's configuration (the agent's `#agent-provider`).
 */
function configuresAnExtension(id: NodeId, node: Pick<NodeLike, "props"> | undefined): boolean {
  if (!isSysPrefixed(id)) return false;
  return refValuesOf(node, SYSTEM_IDS.configuresField).some(
    (target) => target === SYSTEM_IDS.extensionsRoot || isExtensionNodeId(target),
  );
}

function sameValues(
  a: KbNode["props"][string] | undefined,
  b: KbNode["props"][string] | undefined,
) {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

/** The fields whose values differ between `before` and `after`. */
function changedFields(before: KbNode | undefined, after: KbNode | undefined): string[] {
  const fields = new Set([...Object.keys(before?.props ?? {}), ...Object.keys(after?.props ?? {})]);
  return [...fields].filter((field) => !sameValues(before?.props[field], after?.props[field]));
}

/**
 * Whether a write changes an extension's configuration (DESIGN.md → Action
 * registry → Approval → configuration): a value of a field that configures
 * an extension, on whichever node it is written, or a node of a kind that
 * configures an extension (tagged before or after, so tagging and untagging
 * count, and so does minting or deleting one). `nodeOf` reads the fields
 * and kinds as the graph holds them before the write. What configuration
 * holds decides what the code runs with (a provider's endpoint and the key
 * it is sent), so a caller acting for the owner changes it only with the
 * owner's approval. A field's value counts wherever it lands, not only on
 * the node the field is a setting of: a node the configuration may later
 * name (a provider an untagged node could be made into) carries it already.
 */
export function writesConfiguration(write: NodeWrite, nodeOf: NodeOf): boolean {
  const { before, after } = write;
  const kinds = new Set([...typeRefsOf(before), ...typeRefsOf(after)]);
  if ([...kinds].some((kind) => configuresAnExtension(kind, nodeOf(kind)))) return true;
  return changedFields(before, after).some((field) => configuresAnExtension(field, nodeOf(field)));
}

/**
 * Whether a person may write values of the field `fieldId` (its node
 * `fieldNode`) on `nodeId` without force: on any node that is not a system
 * node, and on a system node only where the field is one of its settings.
 */
export function isWritableField(
  nodeId: NodeId,
  fieldId: NodeId,
  fieldNode: Pick<NodeLike, "props"> | undefined,
): boolean {
  return !isSysPrefixed(nodeId) || configures(fieldId, fieldNode, nodeId);
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
  for (const field of changedFields(before, next)) {
    if (!isWritableField(next.id, field, fieldOf(field))) return protectedWrite;
  }
  return null;
}

/**
 * Why committing `tx` over the graph `nodeOf` reads is not a person's to make
 * without force, and which node it is refused for, or null when it is: an
 * upsert {@link systemWriteRefusal} refuses, or the deletion of a system node.
 */
export function systemTxRefusal(
  tx: { readonly upserts: readonly KbNode[]; readonly deletes: readonly NodeId[] },
  nodeOf: (id: NodeId) => KbNode | undefined,
): { readonly id: NodeId; readonly message: string } | null {
  for (const next of tx.upserts) {
    const message = systemWriteRefusal(nodeOf(next.id), next, nodeOf);
    if (message !== null) return { id: next.id, message };
  }
  const deleted = tx.deletes.find((id) => isSysPrefixed(id));
  return deleted === undefined
    ? null
    : {
        id: deleted,
        message: `sys.* nodes are write-protected (use force to override): ${deleted}`,
      };
}
