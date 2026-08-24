/**
 * Pure layout position assigners for non-force modes.
 * `force` is handled by the FA2 worker; these skip it entirely (r10 §2 row 8).
 */
import type { LensEdge, LensNode, LensLayout } from "@/lib/graph-lens";

export type LayoutPoint = { x: number; y: number };

export function computeLayoutPositions(
  layout: LensLayout,
  nodes: LensNode[],
  edges: LensEdge[],
  size: { width: number; height: number } = { width: 800, height: 600 },
): Map<string, LayoutPoint> | null {
  if (layout === "force") return null;
  if (layout === "radial") return radialLayout(nodes, size);
  if (layout === "hierarchical") return hierarchicalLayout(nodes, edges, size);
  if (layout === "grid") return gridLayout(nodes, size);
  return null;
}

/** Ring anchors sorted by id for determinism. */
export function radialLayout(
  nodes: LensNode[],
  size: { width: number; height: number },
): Map<string, LayoutPoint> {
  const out = new Map<string, LayoutPoint>();
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const n = sorted.length;
  const cx = size.width / 2;
  const cy = size.height / 2;
  const R = Math.min(size.width, size.height) * 0.38;
  if (n === 0) return out;
  if (n === 1) {
    out.set(sorted[0]!.id, { x: cx, y: cy });
    return out;
  }
  sorted.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    out.set(node.id, {
      x: cx + Math.cos(angle) * R,
      y: cy + Math.sin(angle) * R,
    });
  });
  return out;
}

/**
 * Layer columns by BFS depth from lowest-in-degree roots (or first id).
 * Deterministic within a fixture.
 */
export function hierarchicalLayout(
  nodes: LensNode[],
  edges: LensEdge[],
  size: { width: number; height: number },
): Map<string, LayoutPoint> {
  const out = new Map<string, LayoutPoint>();
  const ids = nodes.map((n) => n.id).sort();
  const idSet = new Set(ids);
  const children = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const id of ids) {
    children.set(id, []);
    indeg.set(id, 0);
  }
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
    children.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  for (const [, kids] of children) kids.sort();

  let roots = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  if (roots.length === 0 && ids.length > 0) roots = [ids[0]!];

  const depth = new Map<string, number>();
  const queue = [...roots];
  for (const r of roots) depth.set(r, 0);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = depth.get(cur) ?? 0;
    for (const kid of children.get(cur) ?? []) {
      if (depth.has(kid)) continue;
      depth.set(kid, d + 1);
      queue.push(kid);
    }
  }
  for (const id of ids) if (!depth.has(id)) depth.set(id, 0);

  const layers = new Map<number, string[]>();
  for (const id of ids) {
    const d = depth.get(id) ?? 0;
    const list = layers.get(d) ?? [];
    list.push(id);
    layers.set(d, list);
  }
  const maxDepth = Math.max(0, ...layers.keys());
  const colGap = size.width / (maxDepth + 2);
  for (const [d, layer] of layers) {
    layer.sort();
    const rowGap = size.height / (layer.length + 1);
    layer.forEach((id, i) => {
      out.set(id, {
        x: colGap * (d + 1),
        y: rowGap * (i + 1),
      });
    });
  }
  return out;
}

/** Cell grid sorted by id. */
export function gridLayout(
  nodes: LensNode[],
  size: { width: number; height: number },
): Map<string, LayoutPoint> {
  const out = new Map<string, LayoutPoint>();
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const n = sorted.length;
  if (n === 0) return out;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cellW = size.width / (cols + 1);
  const cellH = size.height / (rows + 1);
  sorted.forEach((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.set(node.id, {
      x: cellW * (col + 1),
      y: cellH * (row + 1),
    });
  });
  return out;
}
