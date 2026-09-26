/**
 * A 2D node is a disc in the layout's space (DESIGN-UI → Graph).
 *
 * Sigma draws a node's `size` as its radius, and the 2D renderers draw it in
 * the layout's own units (`itemSizesReference: "positions"`), so a disc and
 * the spacing round it scale together: a small window or a zoom out shrinks
 * both, and never makes the nodes grow over each other. This module owns the
 * relation, once:
 *
 * - `discRadius`: the lens size (3–20, from degree or a size-by) as a radius,
 *   bounded against the force layout's spacing — the ForceAtlas2 settings of
 *   `fa2-layout` settle a node's nearest neighbour about 9 units away, so a
 *   leaf's disc is a sixth of that and the largest hub's ten units;
 * - `separateDiscs`: every 2D layout ends by pushing apart the discs it
 *   placed that still overlap (a hub and its ring of leaves), moving each as
 *   little as it can; `DiscSettle` says when — after any write that changed
 *   the graph's shape or a disc's radius;
 * - `clusterPlacement`: the cluster renderer's groups, each packed as a
 *   sunflower stepped by its members' radii (`discSpacing` apart) and set
 *   on a ring just wide enough that every two stand their widths apart;
 * - `discSpacing`: how far apart a placed layout (radial, hierarchical,
 *   grid) sets two neighbours at least — their radii and the margin — so
 *   its ring, column or cell grows to hold its discs;
 * - `linkWidth`: a link's stroke, in the same units (sigma draws edges in
 *   the items' reference too), a hairline at the force layout's spacing.
 */
import type Graph from "graphology";
import noverlap from "graphology-layout-noverlap";

/** Layout units of radius per unit of lens size. */
const DISC_UNIT = 0.5;
/** The clear space `separateDiscs` keeps between two discs, layout units. */
const DISC_MARGIN = 1;

/** A node's disc radius, in layout units, for its lens size. */
export function discRadius(size: number): number {
  return size * DISC_UNIT;
}

/** A link's stroke per √weight, layout units: a hairline at a leaf's scale. */
const LINK_UNIT = 0.6;

/** A link's stroke width, in layout units: √weight, so repeated links read thicker. */
export function linkWidth(weight: number): number {
  return Math.max(1, Math.sqrt(weight)) * LINK_UNIT;
}

/**
 * How far apart two neighbouring discs of a placed layout stand at least,
 * centre to centre: clear of each other by the margin `separateDiscs` keeps
 * round each disc, so it finds nothing there to move.
 */
export function discSpacing(a: { readonly size: number }, b: { readonly size: number }): number {
  return discRadius(a.size) + discRadius(b.size) + 2 * DISC_MARGIN + 0.01;
}

/** The largest disc a lens size can ask for (`resolveSize` caps sizes at 20). */
export const MAX_DISC_RADIUS = discRadius(20);

/**
 * Push apart the discs that overlap, in place (each disc's radius is its
 * `size`). A bounded pass of noverlap: it clears what a layout leaves, and
 * may stop short from a badly overlapping start, so layouts place clear first.
 */
export function separateDiscs(graph: Graph): void {
  if (graph.order < 2) return;
  noverlap.assign(graph, {
    maxIterations: 200,
    settings: { margin: DISC_MARGIN, ratio: 1, speed: 3, expansion: 1.1, gridSize: 20 },
  });
}

/**
 * The one way a 2D graph's discs settle once sigma's graph has been
 * written: whenever its shape or any disc's radius changed — a new node set,
 * or a new size encoding on the same one — the discs are separated, by the
 * layout when it stops if it is still moving (`fa2-layout` separates on
 * settle), and now if it is still (a placed or cluster layout, or a force
 * layout already idle). A write that changed neither moves nothing.
 */
export class DiscSettle {
  private radii: string | null = null;

  /** Sigma's graph now holds `nodes`; `reshaped` when its topology changed. */
  written(
    graph: Graph,
    nodes: readonly { readonly id: string; readonly size: number }[],
    { reshaped, moving }: { readonly reshaped: boolean; readonly moving: boolean },
  ): void {
    const radii = nodes.map((n) => `${n.id}:${discRadius(n.size)}`).join("|");
    const resized = radii !== this.radii;
    this.radii = radii;
    if ((reshaped || resized) && !moving) separateDiscs(graph);
  }

  /** A new sigma: nothing has settled yet. */
  reset(): void {
    this.radii = null;
  }
}

/** The clear space between two groups on the ring. */
const GROUP_GAP = 12;
/** The golden angle: consecutive members turn by it, so none lines up with another. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** How much room a member's cell takes beyond its disc: a sunflower does not pack tight. */
const CELL_ROOM = 1.3;

type Placed = { readonly id: string; readonly x: number; readonly y: number; readonly r: number };

/**
 * One group packed round its centre as a sunflower whose steps are its
 * members' discs: the largest at the centre, each next one on the golden
 * angle at the radius that leaves room for every disc placed before it
 * (their cells' area, `discSpacing` apart), so a hub's leaves ring it clear
 * of it and of each other. Returns each member's offset and the group's
 * radius.
 */
function packGroup(members: readonly { readonly id: string; readonly size: number }[]): {
  readonly placed: readonly Placed[];
  readonly radius: number;
} {
  const bySize = members.toSorted((a, b) => b.size - a.size || (a.id < b.id ? -1 : 1));
  const placed: Placed[] = [];
  let area = 0;
  let radius = 0;
  bySize.forEach((member, k) => {
    const r = discRadius(member.size);
    const cell = discSpacing(member, member);
    const d = k === 0 ? 0 : Math.sqrt(area / Math.PI) + cell / 2;
    area += cell * cell * CELL_ROOM;
    placed.push({ id: member.id, x: Math.cos(k * GOLDEN) * d, y: Math.sin(k * GOLDEN) * d, r });
    radius = Math.max(radius, d + r);
  });
  return { placed, radius };
}

/** Each group's angle on the ring: its share of the turn is its share of the widths. */
function ringAngles(widths: readonly number[]): number[] {
  const around = widths.reduce((sum, w) => sum + 2 * w, 0);
  let arc = 0;
  return widths.map((w) => {
    const angle = ((arc + w) / Math.max(around, 1)) * 2 * Math.PI;
    arc += 2 * w;
    return angle;
  });
}

/**
 * The ring's radius: the least at which every two groups' centres stand at
 * least their half-widths apart. A chord across the angle Δθ between two
 * centres is 2R·sin(Δθ/2), so R is the largest (wᵢ + wⱼ) / (2·sin(Δθ/2))
 * over every pair — two groups are one chord across the diameter.
 */
function ringRadius(widths: readonly number[], angles: readonly number[]): number {
  let ring = 0;
  for (let i = 0; i < widths.length; i++)
    for (let j = i + 1; j < widths.length; j++) {
      const turn = Math.abs((angles[j] ?? 0) - (angles[i] ?? 0));
      const half = Math.min(turn, 2 * Math.PI - turn) / 2;
      const need = (widths[i] ?? 0) + (widths[j] ?? 0);
      ring = Math.max(ring, need / (2 * Math.max(Math.sin(half), 1e-6)));
    }
  return ring;
}

/**
 * Where the cluster renderer places each node: each group packed by its
 * members' discs (`packGroup`), the groups on one ring in key order, each
 * keeping a share of the turn in proportion to its width (`ringAngles`), at
 * the smallest radius where every pair's chord is at least the sum of their
 * widths (`ringRadius`). `separateDiscs` then settles what is left.
 */
export function clusterPlacement(
  nodes: readonly { readonly id: string; readonly clusterKey: string; readonly size: number }[],
): Map<string, { x: number; y: number }> {
  const byGroup = new Map<string, (typeof nodes)[number][]>();
  for (const node of nodes) {
    const members = byGroup.get(node.clusterKey);
    if (members === undefined) byGroup.set(node.clusterKey, [node]);
    else members.push(node);
  }
  const groups = [...byGroup.keys()].toSorted().map((key) => packGroup(byGroup.get(key) ?? []));
  const widths = groups.map((group) => group.radius + GROUP_GAP / 2);
  const angles = ringAngles(widths);
  const ring = ringRadius(widths, angles);
  const out = new Map<string, { x: number; y: number }>();
  groups.forEach((group, g) => {
    const angle = angles[g] ?? 0;
    const cx = Math.cos(angle) * ring;
    const cy = Math.sin(angle) * ring;
    for (const member of group.placed) out.set(member.id, { x: cx + member.x, y: cy + member.y });
  });
  return out;
}
