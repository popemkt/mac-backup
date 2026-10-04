/**
 * Pure canvas selection helpers — no React deps.
 * Manages a unified selection of nodes + edges with additive/toggle ops, and
 * the scope it is made in: the group entered, whose members a press then
 * reaches one by one (plan 2026-10-02, decision 12).
 */
import {
  ancestorsOf,
  boxCorners,
  canvasMembership,
  isWithin,
  withMembers,
  type CanvasDoc,
  type CanvasMembership,
  type CanvasNode,
} from "@kb/canvas";

export interface CanvasSelection {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

export const EMPTY_SELECTION: CanvasSelection = Object.freeze({
  nodeIds: new Set<string>(),
  edgeIds: new Set<string>(),
});

export function selectionEmpty(sel: CanvasSelection): boolean {
  return sel.nodeIds.size === 0 && sel.edgeIds.size === 0;
}

export function selectionCount(sel: CanvasSelection): number {
  return sel.nodeIds.size + sel.edgeIds.size;
}

export function selectNode(nodeId: string): CanvasSelection {
  return { nodeIds: new Set([nodeId]), edgeIds: new Set() };
}

export function selectEdge(edgeId: string): CanvasSelection {
  return { nodeIds: new Set(), edgeIds: new Set([edgeId]) };
}

export function toggleNode(sel: CanvasSelection, nodeId: string): CanvasSelection {
  const next = new Set(sel.nodeIds);
  if (next.has(nodeId)) next.delete(nodeId);
  else next.add(nodeId);
  return { nodeIds: next, edgeIds: new Set(sel.edgeIds) };
}

export function toggleEdge(sel: CanvasSelection, edgeId: string): CanvasSelection {
  const next = new Set(sel.edgeIds);
  if (next.has(edgeId)) next.delete(edgeId);
  else next.add(edgeId);
  return { nodeIds: new Set(sel.nodeIds), edgeIds: next };
}

/**
 * Where a press selects: the group entered (a double-click enters one, Esc
 * leaves it), or the canvas itself (null). Inside it a press reaches the
 * group's own members; outside it a whole group is one item, as in tldraw
 * and ShapesXR.
 */
export type CanvasScope = string | null;

/** `scope` as `membership` still has it: a group that is gone is the canvas. */
export function scopeIn(membership: CanvasMembership, scope: CanvasScope): CanvasScope {
  return scope !== null && membership.isGroup(scope) ? scope : null;
}

/**
 * What a press on item `id` selects in `scope`, and the scope it is made
 * in: the item of `id`'s groups that belongs directly to the scope. A press
 * on something outside the scope steps out of it, as far as it must.
 */
export function pickIn(
  membership: CanvasMembership,
  id: string,
  scope: CanvasScope,
): { readonly id: string; readonly scope: CanvasScope } {
  const above = ancestorsOf(membership, id);
  let at = scopeIn(membership, scope);
  while (at !== null && !above.includes(at)) at = membership.parentOf(at);
  const chain = [id, ...above];
  const index = at === null ? chain.length : chain.indexOf(at);
  return { id: chain[index - 1] ?? id, scope: at };
}

/**
 * A double-click on item `id` in `scope`: one group deeper toward it, the
 * next item on the way selected — or, on a group a press selects whole,
 * into it with nothing selected. Null when a press there selects `id`
 * itself and it is no group: the double-click is the item's own.
 */
export function enterToward(
  membership: CanvasMembership,
  id: string,
  scope: CanvasScope,
): { readonly id: string | null; readonly scope: CanvasScope } | null {
  const picked = pickIn(membership, id, scope);
  if (picked.id !== id) return pickIn(membership, id, picked.id);
  return membership.isGroup(id) ? { id: null, scope: id } : null;
}

/**
 * Every item that belongs directly to `scope` — on the canvas, its loose
 * items and its groups — and the edges among what they carry.
 */
export function selectAll(doc: CanvasDoc, scope: CanvasScope = null): CanvasSelection {
  const membership = canvasMembership(doc.nodes);
  const nodeIds = new Set(membership.membersOf(scopeIn(membership, scope)));
  const carried = withMembers(doc.nodes, nodeIds);
  return {
    nodeIds,
    edgeIds: new Set(
      doc.edges.filter((e) => carried.has(e.fromNode) && carried.has(e.toNode)).map((e) => e.id),
    ),
  };
}

/**
 * What a marquee over `ids` selects in `scope`: each item as a press would
 * pick it there (`pickIn`), and none outside the scope.
 */
export function pickAllIn(
  membership: CanvasMembership,
  ids: Iterable<string>,
  scope: CanvasScope,
): Set<string> {
  const inside = scopeIn(membership, scope);
  const picked = new Set<string>();
  for (const id of ids) {
    if (inside !== null && !isWithin(membership, id, inside)) continue;
    picked.add(pickIn(membership, id, inside).id);
  }
  return picked;
}

/** Select all nodes whose bounding box, as the top view sees it, intersects the given rectangle. */
export function marqueeSelect(
  nodes: CanvasNode[],
  rect: { x: number; y: number; w: number; h: number },
): Set<string> {
  const ids = new Set<string>();
  const rx = Math.min(rect.x, rect.x + rect.w);
  const ry = Math.min(rect.y, rect.y + rect.h);
  const rr = Math.max(rect.x, rect.x + rect.w);
  const rb = Math.max(rect.y, rect.y + rect.h);
  for (const n of nodes) {
    const corners = boxCorners(n);
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    if (
      Math.max(...xs) > rx &&
      Math.min(...xs) < rr &&
      Math.max(...ys) > ry &&
      Math.min(...ys) < rb
    ) {
      ids.add(n.id);
    }
  }
  return ids;
}

/** Merge additive marquee results into existing selection. */
export function addNodes(sel: CanvasSelection, ids: Set<string>): CanvasSelection {
  const merged = new Set(sel.nodeIds);
  for (const id of ids) merged.add(id);
  return { nodeIds: merged, edgeIds: new Set(sel.edgeIds) };
}

/**
 * Delete all selected nodes + edges from doc; a group goes with its members.
 * Cascade: edges incident to deleted nodes are also removed.
 */
export function deleteSelected(doc: CanvasDoc, sel: CanvasSelection): CanvasDoc {
  const deadNodes = withMembers(doc.nodes, sel.nodeIds);
  const deadEdges = sel.edgeIds;
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => !deadNodes.has(n.id)),
    edges: doc.edges.filter(
      (e) => !deadEdges.has(e.id) && !deadNodes.has(e.fromNode) && !deadNodes.has(e.toNode),
    ),
  };
}
