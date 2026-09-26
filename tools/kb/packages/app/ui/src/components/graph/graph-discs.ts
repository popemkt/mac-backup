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
 *   little as it can;
 * - `clusterPlacement`: the cluster renderer's groups, each packed by disc
 *   size and set on a ring whose length is the sum of their widths;
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

/** Push apart the discs that overlap, in place (each disc's radius is its `size`). */
export function separateDiscs(graph: Graph): void {
  if (graph.order < 2) return;
  noverlap.assign(graph, {
    maxIterations: 200,
    settings: { margin: DISC_MARGIN, ratio: 1, speed: 3, expansion: 1.1, gridSize: 20 },
  });
}

/** The step of a group's sunflower packing: a leaf's diameter and the margin, with room. */
const PACK = 4.5;
/** The clear space between two groups on the ring. */
const GROUP_GAP = 12;

/**
 * Where the cluster renderer places each node: its group packed as a
 * sunflower round the group's centre, the groups on one ring in key order,
 * each given an arc as wide as it is. `separateDiscs` then settles the hubs.
 */
export function clusterPlacement(
  nodes: readonly { readonly id: string; readonly clusterKey: string }[],
): Map<string, { x: number; y: number }> {
  const byGroup = new Map<string, string[]>();
  for (const node of nodes) {
    const members = byGroup.get(node.clusterKey);
    if (members === undefined) byGroup.set(node.clusterKey, [node.id]);
    else members.push(node.id);
  }
  const groups = [...byGroup.keys()].toSorted();
  const radii = groups.map((g) => PACK * Math.sqrt(byGroup.get(g)?.length ?? 1) + GROUP_GAP / 2);
  const around = radii.reduce((sum, r) => sum + 2 * r, 0);
  const ring = groups.length < 2 ? 0 : around / (2 * Math.PI);
  const out = new Map<string, { x: number; y: number }>();
  let arc = 0;
  groups.forEach((group, g) => {
    const r = radii[g] ?? 0;
    const angle = ((arc + r) / Math.max(around, 1)) * 2 * Math.PI;
    arc += 2 * r;
    const cx = Math.cos(angle) * ring;
    const cy = Math.sin(angle) * ring;
    (byGroup.get(group) ?? []).forEach((id, k) => {
      const d = PACK * Math.sqrt(k + 0.5);
      out.set(id, { x: cx + Math.cos(k * 2.4) * d, y: cy + Math.sin(k * 2.4) * d });
    });
  });
  return out;
}
