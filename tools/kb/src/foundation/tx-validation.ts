import type { KbNode, NodeId } from "./model.ts";
import type { StoreTx } from "./storage/store.ts";

/** Validate the prospective outline before it can be persisted. */
export function txIntegrityError(previous: KbNode[], tx: StoreTx): string | null {
  const before = new Map(previous.map((node) => [node.id, node]));
  const next = new Map(before);
  for (const id of tx.deletes) next.delete(id);
  for (const node of tx.upserts) next.set(node.id, node);

  const parentOf = new Map<NodeId, NodeId>();
  for (const node of next.values()) {
    const local = new Set<NodeId>();
    for (const childId of node.children) {
      if (childId === node.id) return `node ${node.id} cannot parent itself`;
      if (!next.has(childId)) return `node ${node.id} references missing child ${childId}`;
      if (local.has(childId)) return `node ${node.id} references child ${childId} twice`;
      local.add(childId);
      const parent = parentOf.get(childId);
      if (parent && parent !== node.id) return `node ${childId} has multiple parents`;
      parentOf.set(childId, node.id);
    }
  }

  // A shallow delete used to turn descendants into accidental forest roots.
  // Survivors must be reparented by the same transaction or be deleted too.
  const deleted = new Set(tx.deletes);
  const stack = [...deleted];
  const oldDescendants = new Set<NodeId>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const childId of before.get(id)?.children ?? []) {
      if (deleted.has(childId) || oldDescendants.has(childId)) continue;
      oldDescendants.add(childId);
      stack.push(childId);
    }
  }
  for (const id of oldDescendants) {
    if (next.has(id) && !parentOf.has(id)) return `delete would orphan descendant ${id}`;
  }

  for (const id of next.keys()) {
    const seen = new Set<NodeId>();
    let cursor: NodeId | undefined = id;
    while (cursor) {
      if (seen.has(cursor)) return `cycle detected at ${cursor}`;
      seen.add(cursor);
      cursor = parentOf.get(cursor);
    }
  }
  return null;
}
