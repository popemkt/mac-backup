/**
 * Snapping for transformed items (DESIGN-UI.md → Canvas), in one module.
 * A transform is snapped one of two ways, by what made it:
 *
 * - **A carry across the floor plan** (a drag on a card, or an
 *   unconstrained grab), `snapCarry`: alignment on x and y, and surfaces.
 * - **Every other transform** (a constrained grab, Alt-drag, a rotate, a
 *   scale, an extrude, any gizmo handle), `snapPrecise`: a move aligns on
 *   each canvas axis it runs along, otherwise steps along its axes by the
 *   grid; a turn goes in angle steps; a stretch lands the selection's extent
 *   on grid multiples; an extrude lands the lead item's depth on them.
 *
 * The rules they are made of:
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
 * - **The grid** ({@link GRID_STEP}, the dot grid): a move steps by it from
 *   where it began (Blender's increment snap), and a size lands on its
 *   multiples.
 * - **Angles**: a turn goes in steps of {@link TURN_STEP} (`snapTurn`),
 *   from where it began.
 *
 * Holding ⌘ suspends every snap: the gesture reports it as `free`, and the
 * pointer reducer then asks none of these; neither does a typed value.
 */
import {
  IDENTITY,
  axisAngleOf,
  boxCorners,
  canvasDepth,
  canvasElevation,
  canvasTop,
  turnAbout,
  type CanvasNode,
  type CanvasTransform,
  type CanvasVec,
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

/** The canvas's grid, canvas units: the dot grid both projections draw on the floor. */
export const GRID_STEP = 20;

/** The step a turn snaps to, radians: 15°. */
const TURN_STEP = Math.PI / 12;

/** `t` with its turn rounded to the nearest whole step about the same axis. */
function snapTurn(t: CanvasTransform): CanvasTransform {
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

/** A move across the floor, snapped on x and y. */
export function snapCanvasMove(
  moving: CanvasNode,
  others: readonly CanvasNode[],
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
// GAP [[01M41W5769NCQYYYWC9NMFWM3J]]
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

/** A transform as snapping left it, and the alignments it snapped to. */
export interface SnappedTransform {
  readonly transform: CanvasTransform;
  readonly guides: SnapGuide[];
}

/**
 * A carry across the floor plan, led by `lead` (as it was) past `others`:
 * aligned on x and y, standing on the surface it comes over.
 */
export function snapCarry(
  t: CanvasTransform,
  lead: CanvasNode,
  others: readonly CanvasNode[],
  zoom: number,
): SnappedTransform {
  const aligned = snapCanvasMove(lead, others, t.move.x, t.move.y, zoom);
  const surface = snapToSurface(lead, others, aligned.dx, aligned.dy);
  return {
    transform: { ...t, move: { x: aligned.dx, y: aligned.dy, z: surface.dz } },
    guides: [...aligned.guides, ...surface.guides],
  };
}

/** Each axis with its column in an axes matrix. */
const AXES = [
  { axis: "x", i: 0 },
  { axis: "y", i: 1 },
  { axis: "z", i: 2 },
] as const satisfies readonly { axis: SnapAxis; i: number }[];

/** Column `i` of `t`'s axes, a unit direction. */
const columnOf = (t: CanvasTransform, i: 0 | 1 | 2): CanvasVec => ({
  x: t.axes[i],
  y: t.axes[3 + i] ?? 0,
  z: t.axes[6 + i] ?? 0,
});
const dot = (a: CanvasVec, b: CanvasVec) => a.x * b.x + a.y * b.y + a.z * b.z;
const onCanvasAxes = (t: CanvasTransform) =>
  t.axes.every((v, i) => Math.abs(v - (IDENTITY[i] ?? 0)) < 1e-9);
/** `v` to the nearest whole step of the grid, halves away from 0 either way. */
const stepped = (v: number) => Math.sign(v) * Math.round(Math.abs(v) / GRID_STEP) * GRID_STEP + 0;

/** How far `items` reach along `dir`: the spread of their corners. */
function extentAlong(items: readonly CanvasNode[], dir: CanvasVec): number {
  const reach = items.flatMap((item) => boxCorners(item).map((corner) => dot(corner, dir)));
  return reach.length === 0 ? 0 : Math.max(...reach) - Math.min(...reach);
}

/**
 * `t`'s move, part by part along its axes: a part along a canvas axis
 * aligns with `others` when within the tolerance, and otherwise every part
 * it moves steps by the grid; a part it does not move stays put.
 */
function snapMove(
  t: CanvasTransform,
  lead: CanvasNode,
  others: readonly CanvasNode[],
  zoom: number,
): { move: CanvasVec; guides: SnapGuide[] } {
  const guides: SnapGuide[] = [];
  const aligns = onCanvasAxes(t);
  let move: CanvasVec = { x: 0, y: 0, z: 0 };
  for (const { axis, i } of AXES) {
    const dir = columnOf(t, i);
    const part = dot(t.move, dir);
    if (Math.abs(part) < 1e-9) continue;
    const aligned = aligns ? snapAlong(axis, lead, others, part, zoom) : null;
    if (aligned?.guide) guides.push(aligned.guide);
    const to = aligned?.guide ? aligned.delta : stepped(part);
    move = { x: move.x + dir.x * to, y: move.y + dir.y * to, z: move.z + dir.z * to };
  }
  return { move, guides };
}

/**
 * `t`'s stretch, landing the extent of `moving` along each stretched axis on
 * a multiple of the grid — a size under one step is left as it is, so a
 * small item can still be scaled — and a stretch every way
 * alike stays alike, landed by the longest extent.
 */
function snapStretch(t: CanvasTransform, moving: readonly CanvasNode[]): CanvasVec {
  const by = t.stretch;
  const extents = AXES.map(({ i }) => extentAlong(moving, columnOf(t, i)));
  const land = (extent: number, f: number) =>
    f === 1 || extent < 1e-9 || extent * f < GRID_STEP ? f : stepped(extent * f) / extent;
  if (by.x === by.y && by.y === by.z) {
    const f = land(Math.max(...extents), by.x);
    return { x: f, y: f, z: f };
  }
  return {
    x: land(extents[0] ?? 0, by.x),
    y: land(extents[1] ?? 0, by.y),
    z: land(extents[2] ?? 0, by.z),
  };
}

/**
 * Any transform but a carry across the floor plan, of `moving` (as they
 * were, the lead first) past `others`: its move aligned or stepped by the
 * grid, its turn in angle steps, its stretch landing sizes on grid
 * multiples, and its extrude landing the lead's depth on one.
 */
export function snapPrecise(
  t: CanvasTransform,
  moving: readonly CanvasNode[],
  others: readonly CanvasNode[],
  zoom: number,
): SnappedTransform {
  const lead = moving[0];
  if (lead === undefined) return { transform: t, guides: [] };
  const { move, guides } = snapMove(t, lead, others, zoom);
  const depth = canvasDepth(lead);
  const extrude = t.extrude === 0 ? 0 : Math.max(0, stepped(depth + t.extrude)) - depth;
  const transform = { ...snapTurn(t), move, stretch: snapStretch(t, moving), extrude };
  return { transform, guides };
}
