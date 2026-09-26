/**
 * Pure layout position assigners for non-force modes.
 * `force` is handled by the FA2 worker; these skip it entirely (r10 §2 row 8).
 */
import type { LensEdge, LensNode, LensLayout } from "@/lib/graph-lens";

export type LayoutPoint = { x: number; y: number };

/** How far apart two neighbouring nodes must stand, centre to centre (none by default). */
export type LayoutSpacing = (a: LensNode, b: LensNode) => number;
const NO_SPACING: LayoutSpacing = () => 0;

/**
 * Where a placed layout puts each node: spread over a box of `size`, and
 * never closer to the next node along its ring, column or row than `spacing`
 * says — the ring, the column or the cell grows to hold them.
 */
export function computeLayoutPositions(
  layout: LensLayout,
  nodes: LensNode[],
  edges: LensEdge[],
  size: { width: number; height: number } = { width: 800, height: 600 },
  spacing: LayoutSpacing = NO_SPACING,
): Map<string, LayoutPoint> | null {
  if (layout === "force") return null;
  if (layout === "radial") return radialLayout(nodes, size, spacing);
  if (layout === "hierarchical") return hierarchicalLayout(nodes, edges, size, spacing);
  return gridLayout(nodes, size, spacing);
}

/** Each node's offset along a line: evenly `step` apart, or further where `spacing` asks. */
function along(line: readonly LensNode[], step: number, spacing: LayoutSpacing): number[] {
  const out: number[] = [];
  let at = 0;
  line.forEach((node, i) => {
    const previous = line[i - 1];
    if (previous !== undefined) at += Math.max(step, spacing(previous, node));
    out.push(at);
  });
  return out;
}

/** The spacing the largest node asks of its own kind: a column's or a cell's least width. */
function widest(nodes: readonly LensNode[], spacing: LayoutSpacing): number {
  return nodes.reduce((most, node) => Math.max(most, spacing(node, node)), 0);
}

/** Ring anchors sorted by id for determinism. */
export function radialLayout(
  nodes: LensNode[],
  size: { width: number; height: number },
  spacing: LayoutSpacing = NO_SPACING,
): Map<string, LayoutPoint> {
  const out = new Map<string, LayoutPoint>();
  const sorted = [...nodes].toSorted((a, b) => a.id.localeCompare(b.id));
  const n = sorted.length;
  const cx = size.width / 2;
  const cy = size.height / 2;
  if (n === 0) return out;
  // The ring's length: every neighbour's spacing, the last back round to the first.
  const first = sorted[0];
  const last = sorted[n - 1];
  const offsets = along(sorted, 0, spacing);
  const closing = first !== undefined && last !== undefined ? spacing(last, first) : 0;
  const length = (offsets[n - 1] ?? 0) + closing;
  const R = Math.max(Math.min(size.width, size.height) * 0.38, length / (2 * Math.PI));
  const [only] = sorted;
  if (n === 1 && only !== undefined) {
    out.set(only.id, { x: cx, y: cy });
    return out;
  }
  sorted.forEach((node, i) => {
    const share = length > 0 ? (offsets[i] ?? 0) / length : i / n;
    const angle = 2 * Math.PI * share - Math.PI / 2;
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
// oxlint-disable-next-line complexity -- GAP [[01M1MGCR50QEXX7R4JDJ51HQFY]]
export function hierarchicalLayout(
  nodes: LensNode[],
  edges: LensEdge[],
  size: { width: number; height: number },
  spacing: LayoutSpacing = NO_SPACING,
): Map<string, LayoutPoint> {
  const out = new Map<string, LayoutPoint>();
  const ids = nodes.map((n) => n.id).toSorted();
  const idSet = new Set(ids);
  const children = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const id of ids) {
    children.set(id, []);
    indeg.set(id, 0);
  }
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
    children.get(e.source)?.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  for (const [, kids] of children) kids.sort();

  let roots = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const [firstId] = ids;
  if (roots.length === 0 && firstId !== undefined) roots = [firstId];

  const depth = new Map<string, number>();
  const queue = [...roots];
  for (const r of roots) depth.set(r, 0);
  for (let cur = queue.shift(); cur !== undefined; cur = queue.shift()) {
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
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const colGap = Math.max(size.width / (maxDepth + 2), widest(nodes, spacing));
  for (const [d, layer] of layers) {
    layer.sort();
    const rowGap = size.height / (layer.length + 1);
    const column = layer.flatMap((id) => byId.get(id) ?? []);
    const offsets = along(column, rowGap, spacing);
    column.forEach((node, i) => {
      out.set(node.id, {
        x: colGap * (d + 1),
        y: rowGap + (offsets[i] ?? 0),
      });
    });
  }
  return out;
}

/** Cell grid sorted by id. */
export function gridLayout(
  nodes: LensNode[],
  size: { width: number; height: number },
  spacing: LayoutSpacing = NO_SPACING,
): Map<string, LayoutPoint> {
  const out = new Map<string, LayoutPoint>();
  const sorted = [...nodes].toSorted((a, b) => a.id.localeCompare(b.id));
  const n = sorted.length;
  if (n === 0) return out;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cell = widest(nodes, spacing);
  const cellW = Math.max(size.width / (cols + 1), cell);
  const cellH = Math.max(size.height / (rows + 1), cell);
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
