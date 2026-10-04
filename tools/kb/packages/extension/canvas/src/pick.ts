/**
 * Where a ray enters an item: the one answer to "what is under this point",
 * asked by the camera model's picking (a screen ray through either lens),
 * by snapping (a ray looking straight down: what a carried item stands on)
 * and by a canvas's relations (what an item rests on). Exact, by the volume
 * the item's shape fills its box with (`CANVAS_SHAPES`), never by a bounding
 * box; pure and GPU-free, so a server answers it as a page does.
 */
import {
  TOP_AXES,
  boxToLocal,
  directionToLocal,
  itemFrame,
  type CanvasAxes,
  type CanvasBox,
  type CanvasVec,
} from "./box.ts";
import type { CanvasShapeKind } from "./doc.ts";
import { CANVAS_SHAPES, onFootprint } from "./shapes.ts";

/** A ray in canvas space: where it starts and which way it runs. */
export interface CanvasRay {
  readonly origin: CanvasVec;
  readonly dir: CanvasVec;
}

/**
 * An item as a ray meets it: a box standing on its footprint, filled by its
 * shape. Absent, the shape is a rectangle (every item that is not a shape).
 */
export interface CanvasPickItem extends CanvasBox {
  readonly shape?: CanvasShapeKind;
}

type Vec = readonly [number, number, number];

/** A stretch of a ray, from where it enters a region to where it leaves. */
type Span = readonly [enter: number, exit: number];

/**
 * The stretch of a ray inside a box, or null when it misses. A flat box is
 * its rectangle: the ray crosses its plane at one point, inside or not.
 */
function boxSpan(ray: CanvasRay, box: { readonly lo: Vec; readonly hi: Vec }): Span | null {
  const origin: Vec = [ray.origin.x, ray.origin.y, ray.origin.z];
  const dir: Vec = [ray.dir.x, ray.dir.y, ray.dir.z];
  let enter = -Infinity;
  let exit = Infinity;
  for (const i of [0, 1, 2] as const) {
    const lo = box.lo[i];
    const hi = box.hi[i];
    if (Math.abs(dir[i]) < 1e-12) {
      // Running parallel to these faces: in the slab all along, or never.
      if (origin[i] < lo || origin[i] > hi) return null;
      continue;
    }
    const near = (lo - origin[i]) / dir[i];
    const far = (hi - origin[i]) / dir[i];
    enter = Math.max(enter, Math.min(near, far));
    exit = Math.min(exit, Math.max(near, far));
    if (enter > exit) return null;
  }
  return [enter, exit];
}

/** Where `a t² + b t + c ≤ 0` along a ray: no stretch, one, or two running off to infinity. */
function quadraticSpans(a: number, b: number, c: number): Span[] {
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return c <= 0 ? [[-Infinity, Infinity]] : [];
    const t = -c / b;
    return [b > 0 ? [-Infinity, t] : [t, Infinity]];
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return a > 0 ? [] : [[-Infinity, Infinity]];
  const root = Math.sqrt(disc);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  return a > 0
    ? [[lo, hi]]
    : [
        [-Infinity, lo],
        [hi, Infinity],
      ];
}

/** The stretches in both `a` and `b`. */
function within(a: readonly Span[], b: readonly Span[]): Span[] {
  return a.flatMap(([a0, a1]) =>
    b.flatMap(([b0, b1]): Span[] => {
      const enter = Math.max(a0, b0);
      const exit = Math.min(a1, b1);
      return enter <= exit ? [[enter, exit]] : [];
    }),
  );
}

/**
 * A coordinate along the ray in the box's unit space, as `at + per · t`:
 * across the footprint -1 to 1 from its centre, up it 0 at the base and 1 at
 * the top. Linear, so a stretch of the ray is the same stretch in either.
 */
interface UnitLine {
  readonly at: number;
  readonly per: number;
}

/** A ray's coordinate (`origin + dir · t`, in the box's own frame) in its unit space, from `start` by `half`. */
const unitLine = (origin: number, dir: number, start: number, half: number): UnitLine => ({
  at: (origin - start) / half,
  per: dir / half,
});

/**
 * The stretches of a ray inside the volume a shape fills its box with
 * (`CANVAS_SHAPES`), given the box's own stretch: exactly, never by a
 * bounding box.
 */
function volumeSpans(
  shape: CanvasShapeKind,
  inBox: Span,
  [x, y, z]: readonly [UnitLine, UnitLine, UnitLine],
): Span[] {
  const { footprint, volume } = CANVAS_SHAPES[shape];
  // X² + Y² (+ k) as a quadratic in t, for the round footprints and volumes.
  const round = (extra: UnitLine, sign: number): Span[] =>
    quadraticSpans(
      x.per ** 2 + y.per ** 2 + sign * extra.per ** 2,
      2 * (x.at * x.per + y.at * y.per + sign * extra.at * extra.per),
      x.at ** 2 + y.at ** 2 + sign * extra.at ** 2 - (sign > 0 ? 1 : 0),
    );
  const none: UnitLine = { at: 0, per: 0 };
  if (volume === "ellipsoid") {
    // X² + Y² + (2Z - 1)² ≤ 1: the ellipsoid the box bounds.
    return within([inBox], round({ at: 2 * z.at - 1, per: 2 * z.per }, 1));
  }
  if (volume === "cone") {
    // X² + Y² ≤ (1 - Z)²: the footprint at the base, narrowing to a point at the top.
    return within([inBox], round({ at: 1 - z.at, per: -z.per }, -1));
  }
  if (footprint === "ellipse") return within([inBox], round(none, 1));
  if (footprint === "diamond") {
    // ±X ± Y ≤ 1: four half-spaces.
    return [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ].reduce<Span[]>(
      (spans, [sx = 1, sy = 1]) =>
        within(spans, quadraticSpans(0, sx * x.per + sy * y.per, sx * x.at + sy * y.at - 1)),
      [inBox],
    );
  }
  return [inBox];
}

/**
 * How far along `ray` it first enters `item` standing at base `z`, as a
 * camera looking along `axes` draws it (`itemFrame`: a flat billboard stands
 * square to it), or null when it misses or only leaves it (the eye inside).
 * A flat item is its footprint on its plane; a solid, the volume its shape
 * fills.
 */
export function rayIntoItem(
  ray: CanvasRay,
  item: CanvasPickItem,
  z: number,
  axes: CanvasAxes,
): number | null {
  // In the box's own frame the box is centred on the origin along its own axes.
  const frame = itemFrame(item, axes, z);
  const origin = boxToLocal(frame, ray.origin);
  const dir = directionToLocal(frame, ray.dir);
  const { half } = frame;
  const box = boxSpan(
    { origin, dir },
    { lo: [-half.x, -half.y, -half.z], hi: [half.x, half.y, half.z] },
  );
  if (box === null) return null;
  const x = unitLine(origin.x, dir.x, 0, half.x);
  const y = unitLine(origin.y, dir.y, 0, half.y);
  const shape = item.shape ?? "rect";
  if (half.z <= 0) {
    const [t] = box;
    return t > 0 && onFootprint(shape, x.at + x.per * t, y.at + y.per * t) ? t : null;
  }
  const up = unitLine(origin.z, dir.z, -half.z, half.z * 2);
  const spans = volumeSpans(shape, box, [x, y, up]).toSorted((a, b) => a[0] - b[0]);
  const ahead = spans.find(([, exit]) => exit > 0);
  return ahead !== undefined && ahead[0] > 0 ? ahead[0] : null;
}

/** How far above everything a ray looking straight down starts, canvas units. */
const ABOVE_ALL = 1e7;

/**
 * Whether `item`'s top view covers the floor point `at`: a ray looking
 * straight down through it enters the item. What snapping stands an item
 * on, and where a carry finds the top it passes over, are this answer.
 */
export function coversFromAbove(
  item: CanvasPickItem,
  at: { readonly x: number; readonly y: number },
): boolean {
  const down: CanvasRay = {
    origin: { x: at.x, y: at.y, z: ABOVE_ALL },
    dir: { x: 0, y: 0, z: -1 },
  };
  return rayIntoItem(down, item, item.z ?? 0, TOP_AXES) !== null;
}
