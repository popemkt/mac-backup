/**
 * How items on a canvas stand to one another, in words an agent that cannot
 * see the canvas reasons in (plan 2026-10-02, decision 16): one is left of,
 * north of or above another, rests on it, belongs to its frame, is linked
 * to it, or overlaps it. The same words read both ways — `describe` says
 * them of a canvas, and `place` puts an item where they say — so what an
 * agent is told and what it asks for cannot drift.
 *
 * **Directions are the canvas's own axes**, as the top view (2D) shows
 * them: left and right along x, north (up the page) and south along y,
 * above and below along z, up off the floor. They are never the camera's,
 * which a person orbits at will, nor an item's own, which a turn or a
 * sphere would leave without meaning. A turned item is compared by the box
 * that bounds it along those axes (`boxBounds`).
 */
// Relations and overlaps read an item's world-aligned bounds, not its
// volume, so a turned item or a round solid reads larger than it is.
// GAP [[01M42Q9GJKTE064D3SG8JEPA4M]]
import { boxBounds, type CanvasBounds, type CanvasVec } from "./box.ts";
import { canvasDepth, isGroupNode, type CanvasNode, type CanvasSide } from "./doc.ts";

/**
 * A relation that cannot be resolved on this canvas — an item it names is
 * not there, or is not the kind it needs — said in words a caller can act on.
 */
export class CanvasRelationError extends Error {
  override readonly name = "CanvasRelationError";
}

/** The six plain-word directions, each along one canvas axis. */
export const CANVAS_DIRECTIONS = ["left", "right", "north", "south", "above", "below"] as const;
export type CanvasDirection = (typeof CANVAS_DIRECTIONS)[number];

type Axis = keyof CanvasVec;

/** Each direction as the canvas axis it runs along and which way. */
const DIRECTION_AXES: {
  readonly [D in CanvasDirection]: { readonly axis: Axis; readonly sign: 1 | -1 };
} = {
  left: { axis: "x", sign: -1 },
  right: { axis: "x", sign: 1 },
  north: { axis: "y", sign: -1 },
  south: { axis: "y", sign: 1 },
  above: { axis: "z", sign: 1 },
  below: { axis: "z", sign: -1 },
};

const AXES: readonly Axis[] = ["x", "y", "z"];

/** The direction along `axis` toward `sign`. */
function directionOf(axis: Axis, sign: number): CanvasDirection {
  const found = CANVAS_DIRECTIONS.find(
    (d) => DIRECTION_AXES[d].axis === axis && DIRECTION_AXES[d].sign === Math.sign(sign),
  );
  return found ?? "right";
}

/** The canvas axis a direction runs along, and which way. */
export function directionAxis(direction: CanvasDirection): {
  readonly axis: Axis;
  readonly sign: 1 | -1;
} {
  return DIRECTION_AXES[direction];
}

/** An item's bounds along the canvas's axes. */
export function itemBounds(item: CanvasNode): CanvasBounds {
  const bounds = boxBounds([item]);
  // One box always has corners.
  return bounds ?? { min: { x: item.x, y: item.y, z: 0 }, max: { x: item.x, y: item.y, z: 0 } };
}

/** The middle of some bounds. */
export function boundsCentre({ min, max }: CanvasBounds): CanvasVec {
  return { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
}

/** How far two items' bounds can touch and still not overlap, canvas units: float noise. */
const TOUCH = 1e-3;

/**
 * How far `a` stands from `b` along `axis`, signed by the side it is on (+1
 * past `b`'s far end, -1 before its near end), or null when their spans
 * share room along it. Touching is a gap of 0. Up off the floor a flat
 * item has no span: one at a solid's base, or anywhere up to (not at) its
 * top, is in it — a card on a box's top rests on it, one under the box is
 * buried — and two flat items share room only on one plane.
 */
function gapAlong(
  a: CanvasBounds,
  b: CanvasBounds,
  axis: Axis,
): { readonly gap: number; readonly sign: 1 | -1 } | null {
  const after = a.min[axis] - b.max[axis];
  const before = b.min[axis] - a.max[axis];
  const sign = after >= before ? 1 : -1;
  const gap = Math.max(after, before);
  const flatA = a.max[axis] - a.min[axis] <= TOUCH;
  const flatB = b.max[axis] - b.min[axis] <= TOUCH;
  if (axis === "z" && (flatA || flatB)) {
    if (flatA && flatB) return gap > TOUCH ? { gap, sign } : null;
    // A flat one at a solid's base is in it: only its top is a surface to stand on.
    const flatAtBase = flatA
      ? before >= -TOUCH && before <= TOUCH
      : after >= -TOUCH && after <= TOUCH;
    if (flatAtBase) return null;
  }
  return gap >= -TOUCH ? { gap: Math.max(0, gap), sign } : null;
}

/**
 * Where `a` lies from `b`: the direction along which they stand farthest
 * apart, and the gap between them there; null when they share room along
 * every axis — when they overlap. Placing an item `side` of another with
 * `gap` is read back as exactly that.
 */
export function directionFrom(
  a: CanvasBounds,
  b: CanvasBounds,
): { readonly direction: CanvasDirection; readonly gap: number } | null {
  let best: { direction: CanvasDirection; gap: number } | null = null;
  for (const axis of AXES) {
    const apart = gapAlong(a, b, axis);
    if (apart !== null && (best === null || apart.gap > best.gap)) {
      best = { direction: directionOf(axis, apart.sign), gap: apart.gap };
    }
  }
  return best;
}

/**
 * Whether two items take up the same room: no direction parts them
 * (`directionFrom`). Groups are frames that hold things, so they overlap
 * nothing.
 */
export function overlaps(a: CanvasNode, b: CanvasNode): boolean {
  if (a.id === b.id || isGroupNode(a) || isGroupNode(b)) return false;
  return directionFrom(itemBounds(a), itemBounds(b)) === null;
}

/** Whether an item has volume: something stands on it, and two of them can intersect. */
export function isSolid(item: CanvasNode): boolean {
  return canvasDepth(item) > 0;
}

/**
 * The sides an edge from `from` to `to` leaves and arrives by: the ones
 * facing each other across the floor plan, along whichever of x and y their
 * centres are farther apart on.
 */
export function facingSides(
  from: CanvasNode,
  to: CanvasNode,
): { readonly fromSide: CanvasSide; readonly toSide: CanvasSide } {
  const a = boundsCentre(itemBounds(from));
  const b = boundsCentre(itemBounds(to));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { fromSide: "right", toSide: "left" } : { fromSide: "left", toSide: "right" };
  }
  return dy >= 0 ? { fromSide: "bottom", toSide: "top" } : { fromSide: "top", toSide: "bottom" };
}
