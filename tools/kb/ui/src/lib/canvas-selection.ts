/**
 * Pure canvas selection helpers — no React deps.
 * Manages a unified selection of nodes + edges with additive/toggle ops.
 */
import type { CanvasDoc, CanvasNode } from "@kb/canvas";

export interface CanvasSelection {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

export const EMPTY_SELECTION: CanvasSelection = Object.freeze({
  nodeIds: new Set<string>(),
  edgeIds: new Set<string>(),
}) as CanvasSelection;

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

export function toggleNode(
  sel: CanvasSelection,
  nodeId: string,
): CanvasSelection {
  const next = new Set(sel.nodeIds);
  if (next.has(nodeId)) next.delete(nodeId);
  else next.add(nodeId);
  return { nodeIds: next, edgeIds: new Set(sel.edgeIds) };
}

export function toggleEdge(
  sel: CanvasSelection,
  edgeId: string,
): CanvasSelection {
  const next = new Set(sel.edgeIds);
  if (next.has(edgeId)) next.delete(edgeId);
  else next.add(edgeId);
  return { nodeIds: new Set(sel.nodeIds), edgeIds: next };
}

export function selectAll(doc: CanvasDoc): CanvasSelection {
  return {
    nodeIds: new Set(doc.nodes.map((n) => n.id)),
    edgeIds: new Set(doc.edges.map((e) => e.id)),
  };
}

/** Select all nodes whose bounding box intersects the given rectangle. */
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
    if (n.x + n.width > rx && n.x < rr && n.y + n.height > ry && n.y < rb) {
      ids.add(n.id);
    }
  }
  return ids;
}

/** Merge additive marquee results into existing selection. */
export function addNodes(
  sel: CanvasSelection,
  ids: Set<string>,
): CanvasSelection {
  const merged = new Set(sel.nodeIds);
  for (const id of ids) merged.add(id);
  return { nodeIds: merged, edgeIds: new Set(sel.edgeIds) };
}

/**
 * Delete all selected nodes + edges from doc.
 * Cascade: edges incident to deleted nodes are also removed.
 */
export function deleteSelected(
  doc: CanvasDoc,
  sel: CanvasSelection,
): CanvasDoc {
  const deadNodes = sel.nodeIds;
  const deadEdges = sel.edgeIds;
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => !deadNodes.has(n.id)),
    edges: doc.edges.filter(
      (e) =>
        !deadEdges.has(e.id) &&
        !deadNodes.has(e.fromNode) &&
        !deadNodes.has(e.toNode),
    ),
  };
}
