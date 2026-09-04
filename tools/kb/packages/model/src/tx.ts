import type { KbNode, NodeId } from "./model.ts";
import { present } from "./present.ts";

/**
 * One store transaction: the nodes to write and the ids to drop. The shape
 * the domain validates, so it is authored here rather than on the port that
 * transports it.
 */
export interface StoreTx {
  upserts: KbNode[];
  deletes: NodeId[];
}

function applyTx(previous: KbNode[], tx: StoreTx): Map<NodeId, KbNode> {
  const next = new Map(previous.map((node) => [node.id, node]));
  for (const id of tx.deletes) next.delete(id);
  for (const node of tx.upserts) next.set(node.id, node);
  return next;
}

function parentChildError(next: Map<NodeId, KbNode>): string | null {
  const parentOf = new Map<NodeId, NodeId>();
  for (const node of next.values()) {
    const local = new Set<NodeId>();
    for (const childId of node.children) {
      if (childId === node.id) return `node ${node.id} cannot parent itself`;
      if (!next.has(childId)) return `node ${node.id} references missing child ${childId}`;
      if (local.has(childId)) return `node ${node.id} references child ${childId} twice`;
      local.add(childId);
      const parent = parentOf.get(childId);
      if (parent !== undefined && parent !== node.id) return `node ${childId} has multiple parents`;
      parentOf.set(childId, node.id);
    }
  }
  return null;
}

function parentMap(next: Map<NodeId, KbNode>): Map<NodeId, NodeId> {
  const parentOf = new Map<NodeId, NodeId>();
  for (const node of next.values()) {
    for (const childId of node.children) {
      parentOf.set(childId, node.id);
    }
  }
  return parentOf;
}

function orphanError(
  previous: Map<NodeId, KbNode>,
  next: Map<NodeId, KbNode>,
  parentOf: Map<NodeId, NodeId>,
  deletes: readonly NodeId[],
): string | null {
  const deleted = new Set(deletes);
  const stack = [...deleted];
  const oldDescendants = new Set<NodeId>();
  while (stack.length > 0) {
    const id = present(stack.pop(), "txIntegrityError: pop on non-empty stack");
    for (const childId of previous.get(id)?.children ?? []) {
      if (deleted.has(childId) || oldDescendants.has(childId)) continue;
      oldDescendants.add(childId);
      stack.push(childId);
    }
  }
  for (const id of oldDescendants) {
    if (next.has(id) && !parentOf.has(id)) return `delete would orphan descendant ${id}`;
  }
  return null;
}

function cycleError(next: Map<NodeId, KbNode>, parentOf: Map<NodeId, NodeId>): string | null {
  for (const id of next.keys()) {
    const seen = new Set<NodeId>();
    let cursor: NodeId | undefined = id;
    while (cursor !== undefined) {
      if (seen.has(cursor)) return `cycle detected at ${cursor}`;
      seen.add(cursor);
      cursor = parentOf.get(cursor);
    }
  }
  return null;
}

/** Validate the prospective outline before it can be persisted. */
export function txIntegrityError(previous: KbNode[], tx: StoreTx): string | null {
  const before = new Map(previous.map((node) => [node.id, node]));
  const next = applyTx(previous, tx);
  const childErr = parentChildError(next);
  if (childErr !== null) return childErr;
  const parentOf = parentMap(next);
  const orphan = orphanError(before, next, parentOf, tx.deletes);
  if (orphan !== null) return orphan;
  return cycleError(next, parentOf);
}
