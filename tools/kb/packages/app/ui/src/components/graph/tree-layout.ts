/**
 * The tree renderer's layout, pure: which branches start folded, where every
 * visible node sits, and how a forest of many roots fills the frame.
 *
 * - A small forest opens whole. A larger one (more than `OPEN_BUDGET` nodes)
 *   opens `OPEN_DEPTH` levels deep: roots and their children show, and a
 *   child that has children of its own starts collapsed. Expanding is the
 *   user's gesture; a first look at a big graph is never every node at once.
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

/** How many levels a large tree shows before anything is expanded. */
export const OPEN_DEPTH = 2;
/** A forest of at most this many nodes opens whole. */
const OPEN_BUDGET = 60;
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

function forestIds(forest: readonly LensTreeNode[]): Set<string> {
  const ids = new Set<string>();
  const visit = (nodes: readonly LensTreeNode[]) => {
    for (const n of nodes) {
      ids.add(n.id);
      visit(n.children);
    }
  };
  visit(forest);
  return ids;
}

/**
 * What is folded in one view (its key is `graphViewKey`) and which nodes it
 * has already seen.
 */
export interface TreeFold {
  readonly view: string;
  readonly collapsed: ReadonlySet<string>;
  readonly known: ReadonlySet<string>;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Whether two folds say the same thing (by value: `resolveFold` makes new sets). */
export function sameFold(a: TreeFold | null, b: TreeFold): boolean {
  return (
    a !== null &&
    a.view === b.view &&
    sameSet(a.collapsed, b.collapsed) &&
    sameSet(a.known, b.known)
  );
}

/**
 * The fold for `forest` in `view`. A new view starts from its own first
 * fold (`initiallyCollapsed`); within one view the user's fold stands, and
 * only a node the fold has not seen yet (a store write added it) takes the
 * first fold's answer for itself.
 */
export function resolveFold(
  fold: TreeFold | null,
  view: string,
  forest: readonly LensTreeNode[],
): TreeFold {
  const ids = forestIds(forest);
  const opened = initiallyCollapsed(forest);
  if (fold === null || fold.view !== view) return { view, collapsed: opened, known: ids };
  const collapsed = new Set(fold.collapsed);
  for (const id of opened) if (!fold.known.has(id)) collapsed.add(id);
  return { view, collapsed, known: ids };
}

function forestSize(nodes: readonly LensTreeNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + forestSize(n.children), 0);
}

/**
 * What starts folded: nothing in a forest of at most `budget` nodes, else
 * every node `OPEN_DEPTH - 1` levels down or deeper that has children.
 */
export function initiallyCollapsed(
  forest: readonly LensTreeNode[],
  budget = OPEN_BUDGET,
): Set<string> {
  const ids = new Set<string>();
  if (forestSize(forest) <= budget) return ids;
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
