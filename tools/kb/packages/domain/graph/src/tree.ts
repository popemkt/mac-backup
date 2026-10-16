/**
 * A tree of the edge projection: what the tree renderer and a node's
 * neighbourhood draw when they draw a spanning tree of the chosen edges.
 */
import type { LensEdge } from "./edges.ts";

/** One node of a tree, as the tree renderer draws it. */
export interface LensTreeNode {
  id: string;
  label: string;
  color: string;
  size: number;
  children: LensTreeNode[];
}

/** What a tree reads of a projected node. */
export type LensTreeSource = Omit<LensTreeNode, "children">;

/**
 * Build a cycle-safe forest (or single tree when focus is set) over
 * children[] restricted to the lens node set.
 */
export function buildTreeForest(
  lensNodes: readonly LensTreeSource[],
  edges: readonly LensEdge[],
  focusId: string | null,
): LensTreeNode[] {
  const byLens = new Map(lensNodes.map((n) => [n.id, n]));
  const children = new Map<string, Set<string>>();
  const hasParent = new Set<string>();
  for (const edge of edges) {
    if (!byLens.has(edge.source) || !byLens.has(edge.target)) continue;
    const list = children.get(edge.source) ?? new Set<string>();
    list.add(edge.target);
    children.set(edge.source, list);
    hasParent.add(edge.target);
  }
  // A tree is a spanning projection: shared descendants occur once, cycles keep
  // a deterministic root, and the underlying relationships remain intact.
  const seen = new Set<string>();
  const build = (id: string): LensTreeNode | null => {
    if (seen.has(id)) return null;
    const meta = byLens.get(id);
    if (!meta) return null;
    seen.add(id);
    return {
      id,
      label: meta.label,
      color: meta.color,
      size: meta.size,
      children: [...(children.get(id) ?? [])].map(build).filter((n): n is LensTreeNode => !!n),
    };
  };
  if (focusId !== null && byLens.has(focusId)) {
    const root = build(focusId);
    return root ? [root] : [];
  }
  const ids = [...byLens.keys()].toSorted();
  return [...ids.filter((id) => !hasParent.has(id)), ...ids]
    .map(build)
    .filter((n): n is LensTreeNode => !!n);
}
