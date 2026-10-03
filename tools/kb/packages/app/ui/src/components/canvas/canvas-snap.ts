/**
 * Snapping for carried items (DESIGN-UI.md → Canvas), in one module:
 *
 * - **Alignment**, one rule on each of the canvas's three axes. Along an axis
 *   an item spans from its start by its extent — across the floor its
 *   footprint, up from it its base and depth — and a carried item's start,
 *   end or middle snaps to another item's start, end or middle within
 *   {@link SNAP_TOL} screen pixels, the nearest alignment winning, once per
 *   axis.
 * - **Surfaces**: an item carried across the floor stands on the top of the
 *   highest solid its centre passes over (`snapToSurface`), which is how
 *   things are put on one another.
 * - **Angles**: a turn goes in steps of {@link TURN_STEP} (`snapTurn`),
 *   whichever handle makes it.
 *
 * Holding ⌘ suspends every snap: the gesture reports it as `free`, and the
 * pointer reducer then asks none of these.
 */
import {
  axisAngleOf,
  canvasDepth,
  canvasElevation,
  canvasTop,
  turnAbout,
  type CanvasNode,
  type CanvasTransform,
} from "@kb/canvas";
import { coversFromAbove } from "./canvas-camera";

/** One of the canvas's axes: x and y across the floor, z up from it. */
type SnapAxis = "x" | "y" | "z";

/** An alignment a carried item snapped to: the axis, and where along it. */
export interface SnapGuide {
  axis: SnapAxis;
  pos: number;
}

/** How near an alignment must be to snap, in screen pixels. */
const SNAP_TOL = 5;

/** The step a turn snaps to, radians: 15°. */
const TURN_STEP = Math.PI / 12;

/** `t` with its turn rounded to the nearest whole step about the same axis. */
// Only a transform's turn snaps: a gizmo move does not snap to the grid, and a
// gizmo scale does not snap to grid multiples (plan decision 11).
// GAP [gizmo-grid-snap]
export function snapTurn(t: CanvasTransform): CanvasTransform {
  const { axis, angle } = axisAngleOf(t.turn);
  const stepped = Math.round(angle / TURN_STEP) * TURN_STEP;
  return stepped === angle ? t : { ...t, turn: turnAbout(axis, stepped) };
}

/** Where an item starts along an axis, and how far it reaches. */
function spanOf(item: CanvasNode, axis: SnapAxis): { start: number; size: number } {
  if (axis === "x") return { start: item.x, size: item.width };
  if (axis === "y") return { start: item.y, size: item.height };
  return { start: canvasElevation(item), size: canvasDepth(item) };
}

/**
 * `delta` along `axis` for `moving`, corrected to the nearest alignment with
 * `others` within the tolerance at `zoom`, and the guide it snapped to.
 */
function snapAlong(
  axis: SnapAxis,
  moving: CanvasNode,
  others: readonly CanvasNode[],
  delta: number,
  zoom: number,
): { delta: number; guide: SnapGuide | null } {
  const own = spanOf(moving, axis);
  const start = own.start + delta;
  let best = SNAP_TOL / zoom;
  let correction = 0;
  let position: number | undefined;
  for (const other of others) {
    const span = spanOf(other, axis);
    const pairs: [number, number][] = [
      [start, span.start],
      [start, span.start + span.size],
      [start + own.size, span.start],
      [start + own.size, span.start + span.size],
      [start + own.size / 2, span.start + span.size / 2],
    ];
    for (const [from, to] of pairs) {
      const distance = Math.abs(to - from);
      if (distance < best) {
        best = distance;
        correction = to - from;
        position = to;
      }
    }
  }
  return {
    delta: delta + correction,
    guide: position === undefined ? null : { axis, pos: position },
  };
}

/** A lift up from the floor, snapped on z: to the heights other items stand at. */
export function snapCanvasLift(
  moving: CanvasNode,
  others: readonly CanvasNode[],
  dz: number,
  zoom: number,
) {
  const z = snapAlong("z", moving, others, dz, zoom);
  return { dz: z.delta, guides: z.guide === null ? [] : [z.guide] };
}

/** A move across the floor, snapped on x and y. */
export function snapCanvasMove(
  moving: CanvasNode,
  others: CanvasNode[],
  dx: number,
  dy: number,
  zoom: number,
) {
  const x = snapAlong("x", moving, others, dx, zoom);
  const y = snapAlong("y", moving, others, dy, zoom);
  const guides = [x.guide, y.guide].filter((guide) => guide !== null);
  return { dx: x.delta, dy: y.delta, guides };
}

/** The centre of an item's footprint, moved by (`dx`, `dy`). */
const centreOf = (item: CanvasNode, dx = 0, dy = 0) => ({
  x: item.x + dx + item.width / 2,
  y: item.y + dy + item.height / 2,
});

/**
 * The surface a point on the floor plan stands under: the top of the highest
 * solid in `others` whose top view covers it (`coversFromAbove`), or null
 * over open floor.
 */
// A tilted solid offers its highest corner as its top, and a tilted item
// stands on a surface by its base, not by its lowest point.
// GAP [tilted-stacking]
function surfaceUnder(at: { x: number; y: number }, others: readonly CanvasNode[]): number | null {
  let top: number | null = null;
  for (const other of others) {
    if (canvasDepth(other) <= 0 || !coversFromAbove(other, at)) continue;
    top = Math.max(top ?? -Infinity, canvasTop(other));
  }
  return top;
}

/**
 * The change of elevation for `moving` carried across the floor by (`dx`,
 * `dy`): onto the top of the highest solid its centre comes over, with the
 * guide it snapped to. Off every solid it keeps its height, unless it stood
 * on one when it was picked up: then it comes down to the floor, so an item
 * taken off a pile lands rather than floats.
 */
export function snapToSurface(
  moving: CanvasNode,
  others: readonly CanvasNode[],
  dx: number,
  dy: number,
): { dz: number; guides: SnapGuide[] } {
  const z = canvasElevation(moving);
  const under = surfaceUnder(centreOf(moving, dx, dy), others);
  if (under !== null) return { dz: under - z, guides: [{ axis: "z", pos: under }] };
  const stoodOn = surfaceUnder(centreOf(moving), others);
  return { dz: stoodOn !== null && stoodOn === z ? -z : 0, guides: [] };
}
