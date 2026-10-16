/**
 * Where an edge runs (INSPIRATIONS: edges are drawings): the point each end
 * meets its item at, the way out of the item there, and the route between
 * them, in canvas space. Pure, so both projections draw the one route — the
 * DOM as an SVG path, the scene as a line through its points, climbing from
 * one end's height to the other's — and the pointer's port choice, an edge
 * label and the projection contract read the same answer.
 */
import { boxFrame, boxToWorld, directionToWorld, type CanvasVec } from "./box.ts";
import type { CanvasEdge, CanvasNode, CanvasSide } from "./doc.ts";
import { outlinePoints, type CanvasPathCommand } from "./shapes.ts";

/** Where an end meets its item, and which way out of the item it faces across the floor. */
export interface EdgeTerminal {
  /** The point on the item's side, halfway up it (on a flat item, its plane). */
  readonly at: CanvasVec;
  /** The outward direction across the floor there, unit length. */
  readonly out: { readonly x: number; readonly y: number };
}

/** Each side's middle and outward direction in the box's own frame, by its unit half extents. */
const SIDES: { readonly [S in CanvasSide]: { readonly x: number; readonly y: number } } = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/**
 * Where an edge meets `item`'s `side`, in canvas space: the one answer the
 * route, a drag's preview and the nearest-port choice all read.
 */
// A flat billboard stands up in 3D, but an edge meets it at its box's side
// on the floor, where it lies; and a turned billboard's anchors turn with a
// rotation it does not draw. Anchors on what is drawn come with 3D plan step 9.
// GAP [[01M42G18TDCMPK7BKD9GKS74RT]]
export function sideTerminal(item: CanvasNode, side: CanvasSide = "right"): EdgeTerminal {
  const frame = boxFrame(item);
  const unit = SIDES[side];
  const at = boxToWorld(frame, { x: unit.x * frame.half.x, y: unit.y * frame.half.y, z: 0 });
  const out = directionToWorld(frame, { x: unit.x, y: unit.y, z: 0 });
  const across = Math.hypot(out.x, out.y) || 1;
  return { at, out: { x: out.x / across, y: out.y / across } };
}

/** A point `reach` out of the side `terminal` faces: a curve's control there. */
export function leaving(terminal: EdgeTerminal, reach: number): { x: number; y: number } {
  return {
    x: terminal.at.x + terminal.out.x * reach,
    y: terminal.at.y + terminal.out.y * reach,
  };
}

/** The route an edge runs, in canvas units: the path the top view draws, and its two ends. */
export interface EdgeRoute {
  /** Path data across the floor, as the shape table speaks it (`CanvasPathCommand`). */
  readonly path: readonly CanvasPathCommand[];
  readonly from: EdgeTerminal;
  readonly to: EdgeTerminal;
}

/** How far a curve's controls reach out of its ends for a span `dx` across, canvas units. */
function curveReach(dx: number): number {
  return Math.max(40, Math.abs(dx) * 0.45);
}

/**
 * The route `edge` runs from item `from` to item `to`: a cubic between the
 * sides it leaves and arrives by (right and left by default, as JSON Canvas
 * draws them), each control out along its side's outward direction.
 */
export function edgeRoute(from: CanvasNode, to: CanvasNode, edge: CanvasEdge): EdgeRoute {
  const a = sideTerminal(from, edge.fromSide ?? "right");
  const b = sideTerminal(to, edge.toSide ?? "left");
  const reach = curveReach(b.at.x - a.at.x);
  const c1 = leaving(a, reach);
  const c2 = leaving(b, reach);
  return {
    path: [
      ["M", a.at.x, a.at.y],
      ["C", c1.x, c1.y, c2.x, c2.y, b.at.x, b.at.y],
    ],
    from: a,
    to: b,
  };
}

/**
 * A drag's route from `terminal` to a loose point `end` under the pointer:
 * the curve's first control out of its side, the second on the point.
 */
export function looseRoute(terminal: EdgeTerminal, end: { x: number; y: number }): EdgeRoute {
  const c1 = leaving(terminal, curveReach(end.x - terminal.at.x));
  return {
    path: [
      ["M", terminal.at.x, terminal.at.y],
      ["C", c1.x, c1.y, end.x, end.y, end.x, end.y],
    ],
    from: terminal,
    to: { at: { x: end.x, y: end.y, z: terminal.at.z }, out: { x: 0, y: 0 } },
  };
}

/** Smoothstep: an ease from 0 to 1 that leaves and arrives level. */
const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * Points along a route in canvas space, its curves flattened: across the
 * floor as the path runs, climbing from one end's height to the other's,
 * level as it leaves and as it arrives. What a renderer that draws lines
 * draws, and where a head or a label sits.
 */
export function routePoints(route: EdgeRoute): CanvasVec[] {
  const flat = outlinePoints(route.path);
  const lengths = [0];
  for (let i = 1; i < flat.length; i++) {
    const [x0 = 0, y0 = 0] = flat[i - 1] ?? [];
    const [x1 = 0, y1 = 0] = flat[i] ?? [];
    lengths.push((lengths[i - 1] ?? 0) + Math.hypot(x1 - x0, y1 - y0));
  }
  const total = Math.max(lengths.at(-1) ?? 0, 1e-9);
  const za = route.from.at.z;
  const zb = route.to.at.z;
  return flat.map(([x, y], i) => ({ x, y, z: za + (zb - za) * ease((lengths[i] ?? 0) / total) }));
}

/** The point halfway along a route, across the floor: where an edge's label stands. */
export function routeMidpoint(route: EdgeRoute): { x: number; y: number } {
  const points = routePoints(route);
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    lengths.push((lengths[i - 1] ?? 0) + (a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0));
  }
  const half = (lengths.at(-1) ?? 0) / 2;
  const i = Math.max(
    1,
    lengths.findIndex((l) => l >= half),
  );
  const a = points[i - 1] ?? route.from.at;
  const b = points[i] ?? route.to.at;
  const span = (lengths[i] ?? 0) - (lengths[i - 1] ?? 0);
  const t = span > 0 ? (half - (lengths[i - 1] ?? 0)) / span : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
