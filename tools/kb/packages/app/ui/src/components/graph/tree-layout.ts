/**
 * The tree renderer's layout, pure: which branches start folded, where every
 * visible node sits, and how a forest of many roots fills the frame.
 *
 * - A tree opens `OPEN_DEPTH` levels deep: roots and their children show, and
 *   a child that has children of its own starts collapsed. Expanding is the
 *   user's gesture; a first look is never every node at once.
 * - Each root's subtree is laid out on its own, left to right (a parent's
 *   children stand to its right), and the subtrees are packed into columns
 *   in their order, the column count chosen so the packed forest's shape is
 *   closest to the frame's. A forest of a hundred roots fills the frame as a
 *   few columns instead of one sliver a hundred roots tall.
 *
 * Coordinates follow d3's tree: `x` runs down the frame, `y` across it.
 */
import { hierarchy, tree as d3Tree, type HierarchyPointNode } from "d3-hierarchy";
import type { LensTreeNode } from "@/lib/graph-lens";
import { GRAPH_LABEL_WIDTH, wrapGraphLabel } from "@/lib/graph-label";

/** How many levels a tree shows before anything is expanded. */
export const OPEN_DEPTH = 2;
/** Space between two packed columns, and above the first root of each. */
const COLUMN_GAP = 48;
const LEVEL = GRAPH_LABEL_WIDTH + 56;

interface TreeDatum {
  id: string;
  label: string;
  color: string;
  lines: string[];
  width: number;
  height: number;
  children?: TreeDatum[];
}

type TreePoint = HierarchyPointNode<TreeDatum>;

export interface TreeLayout {
  readonly nodes: readonly TreePoint[];
  readonly links: readonly { readonly source: TreePoint; readonly target: TreePoint }[];
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
}

/** Every node `OPEN_DEPTH - 1` levels down or deeper that has children: folded at first. */
export function initiallyCollapsed(forest: readonly LensTreeNode[]): Set<string> {
  const ids = new Set<string>();
  const visit = (nodes: readonly LensTreeNode[], depth: number) => {
    for (const n of nodes) {
      if (depth >= OPEN_DEPTH - 1 && n.children.length > 0) ids.add(n.id);
      visit(n.children, depth + 1);
    }
  };
  visit(forest, 0);
  return ids;
}

interface Subtree {
  readonly nodes: TreePoint[];
  readonly links: { source: TreePoint; target: TreePoint }[];
  /** Extent down (x) and across (y), from the subtree's own origin. */
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

function layoutSubtree(root: TreeDatum): Subtree {
  const laid = d3Tree<TreeDatum>()
    .nodeSize([1, LEVEL])
    .separation((a, b) => (a.data.height + b.data.height) / 2 + 18)(hierarchy(root));
  const nodes = laid.descendants();
  return {
    nodes,
    links: laid.links(),
    top: Math.min(...nodes.map((n) => n.x - n.data.height / 2)),
    bottom: Math.max(...nodes.map((n) => n.x + n.data.height / 2)),
    left: Math.min(...nodes.map((n) => n.y - 24)),
    right: Math.max(...nodes.map((n) => n.y + n.data.width)),
  };
}

/** Pack subtrees into `columns` columns in order; the packed width and height. */
function pack(subtrees: readonly Subtree[], columns: number) {
  const total = subtrees.reduce((sum, s) => sum + (s.bottom - s.top) + COLUMN_GAP, 0);
  const budget = total / columns;
  const places: { dx: number; dy: number }[] = [];
  let dx = 0;
  let dy = 0;
  let columnWidth = 0;
  let height = 0;
  for (const s of subtrees) {
    const tall = s.bottom - s.top + COLUMN_GAP;
    if (dy > 0 && dy + tall > budget) {
      dx += columnWidth + COLUMN_GAP;
      dy = 0;
      columnWidth = 0;
    }
    places.push({ dx: dx - s.left, dy: dy - s.top });
    dy += tall;
    height = Math.max(height, dy);
    columnWidth = Math.max(columnWidth, s.right - s.left);
  }
  return { places, width: dx + columnWidth, height };
}

/**
 * Lay out the visible forest for a frame of `aspect` (width / height):
 * each root's subtree left to right, packed into the column count whose
 * shape is nearest the frame's.
 */
export function layoutForest(
  forest: readonly LensTreeNode[],
  collapsed: ReadonlySet<string>,
  label: { readonly show: boolean; readonly measure: (text: string) => number },
  aspect: number,
): TreeLayout {
  const datum = (n: LensTreeNode): TreeDatum => {
    const lines = label.show ? wrapGraphLabel(n.label, label.measure) : [];
    return {
      id: n.id,
      label: n.label,
      color: n.color,
      lines,
      width: Math.max(18, ...lines.map(label.measure)) + 18,
      height: Math.max(16, lines.length * 15),
      ...(collapsed.has(n.id) ? {} : { children: n.children.map(datum) }),
    };
  };
  const subtrees = forest.map((root) => layoutSubtree(datum(root)));
  if (subtrees.length === 0) {
    return { nodes: [], links: [], originX: -20, originY: -20, width: 140, height: 140 };
  }
  const target = Math.max(0.1, aspect);
  let best = pack(subtrees, 1);
  for (let columns = 2; columns <= subtrees.length; columns++) {
    const next = pack(subtrees, columns);
    const off = (p: typeof best) => Math.abs(Math.log(p.width / Math.max(1, p.height) / target));
    if (off(next) < off(best)) best = next;
    // Past the frame's shape, more columns only widen it.
    if (next.width / Math.max(1, next.height) > target * 2) break;
  }
  const nodes: TreePoint[] = [];
  const links: { source: TreePoint; target: TreePoint }[] = [];
  subtrees.forEach((s, i) => {
    const place = best.places[i] ?? { dx: 0, dy: 0 };
    for (const n of s.nodes) {
      n.x += place.dy;
      n.y += place.dx;
      nodes.push(n);
    }
    links.push(...s.links);
  });
  return {
    nodes,
    links,
    originX: -20,
    originY: -20,
    width: Math.max(100, best.width) + 40,
    height: Math.max(100, best.height) + 40,
  };
}
