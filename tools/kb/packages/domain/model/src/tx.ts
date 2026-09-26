import { canonicalJson } from "./canonical.ts";
import { cardinalityOf, valueConformanceError } from "./field-type.ts";
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

/** `previous` with `tx` applied: deletes first, then upserts replace whole nodes. */
export function applyTx(previous: readonly KbNode[], tx: StoreTx): Map<NodeId, KbNode> {
  const next = new Map(previous.map((node) => [node.id, node]));
  for (const id of tx.deletes) next.delete(id);
  for (const node of tx.upserts) next.set(node.id, node);
  return next;
}

/**
 * The transaction that turns `previous` into `next`.
 *
 * The inverse of applying one, and it lives beside it for that reason: the
 * only place that needs a diff is an ingest path that was handed a whole node
 * set instead of the transaction that produced it (an external process wrote
 * the store). Everything downstream — the log, the index, the wire — speaks
 * transactions, so the conversion happens once, here, in node terms.
 */
export function diffTx(previous: ReadonlyArray<KbNode>, next: ReadonlyArray<KbNode>): StoreTx {
  const before = new Map(previous.map((node) => [node.id, node]));
  const upserts: KbNode[] = [];
  const deletes: NodeId[] = [];
  const seen = new Set<NodeId>();
  for (const node of next) {
    seen.add(node.id);
    const prev = before.get(node.id);
    if (prev === undefined || canonicalJson(prev) !== canonicalJson(node)) upserts.push(node);
  }
  for (const id of before.keys()) {
    if (!seen.has(id)) deletes.push(id);
  }
  return { upserts, deletes };
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

/**
 * The first value a transaction writes that its field cannot hold.
 *
 * "Writes" is the upserted node's values that its stored version did not hold
 * under the same field — an upsert replaces the whole node, so the unchanged
 * rest of it is carried, not written. Checking only the written values is what
 * keeps a store with legacy values editable: renaming a node never fails over
 * a value it has held since before its field was typed.
 *
 * A field declared `cardinality: one` holds at most one value, so a write
 * that leaves it holding two is refused — whether it appended a second value
 * or replaced one without removing the other. The same scoping applies: a
 * field that already held two before its declaration is not rechecked until a
 * transaction writes to it.
 *
 * GAP [[01M39YM7VRD0K4H70E48R71VRP]] — values already stored are not
 * rechecked, so a retype or a delete in `tx` can strand them.
 */
function writtenValueError(
  before: Map<NodeId, KbNode>,
  next: Map<NodeId, KbNode>,
  tx: StoreTx,
): string | null {
  for (const node of tx.upserts) {
    const stored = before.get(node.id)?.props ?? {};
    for (const [fieldId, values] of Object.entries(node.props)) {
      const held = new Set((stored[fieldId] ?? []).map((value) => canonicalJson(value)));
      const written = values.filter((value) => !held.has(canonicalJson(value)));
      for (const value of written) {
        const err = valueConformanceError(fieldId, value, next);
        if (err !== null) return `node ${node.id}: ${err}`;
      }
      if (written.length > 0 && values.length > 1) {
        if (cardinalityOf(next.get(fieldId)?.props) === "one") {
          return `node ${node.id}: field ${fieldId} holds one value and would hold ${values.length}`;
        }
      }
    }
  }
  return null;
}

/**
 * Validate the prospective graph before it can be persisted: the outline is a
 * forest (every child exists, has one parent, no cycles, no orphaned
 * descendants), and every value the transaction writes conforms to its field.
 */
export function txIntegrityError(previous: KbNode[], tx: StoreTx): string | null {
  const before = new Map(previous.map((node) => [node.id, node]));
  const next = applyTx(previous, tx);
  const childErr = parentChildError(next);
  if (childErr !== null) return childErr;
  const parentOf = parentMap(next);
  const orphan = orphanError(before, next, parentOf, tx.deletes);
  if (orphan !== null) return orphan;
  const cycle = cycleError(next, parentOf);
  if (cycle !== null) return cycle;
  return writtenValueError(before, next, tx);
}

/**
 * One committed transaction as the log records it.
 *
 * `rev` is the log's position, so a client that has seen `rev` knows exactly
 * what it is missing; `origin` is the client that caused the write, carried so
 * a watcher can recognise the confirming echo of its own optimistic apply
 * rather than so the server can skip it. `at` is the caller's `Clock` reading:
 * the log is synchronous, and the seam that owns time is an Effect service.
 */
export interface KbTx {
  rev: number;
  ops: StoreTx;
  at: string;
  origin?: string;
}
