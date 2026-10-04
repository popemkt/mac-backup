/**
 * An item's box in canvas space (plan 2026-10-02, decision 4): its footprint
 * `x, y, width, height` at the height of its base `z`, rising `depth` from
 * there. This module is the one place that says where a box's corners,
 * centre and own axes are, so every reader — the camera model's picking and
 * framing, both projections' drawing, edge anchors, snapping — places an
 * item the same way.
 *
 * A box has its own frame: the origin at the box's centre and its axes
 * along its width, its height and its depth, turned by the item's
 * `rotation` about that centre (`./rotation.ts`). A point given in that
 * frame (`local`) and the same point in the canvas (`world`) convert
 * through {@link boxToWorld} and {@link boxToLocal}.
 */
import {
  apply,
  rotationMatrix,
  transpose,
  type CanvasMatrix,
  type CanvasRotation,
} from "./rotation.ts";

/** A point or a direction in canvas space. */
export interface CanvasVec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** What a box is read from: any canvas item, or anything shaped like one. */
export interface CanvasBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Height of the base above the floor; absent is the floor. */
  readonly z?: number;
  /** How far the box rises from its base; absent or 0 is flat. */
  readonly depth?: number;
  /** Its turn about its centre, degrees; an absent angle is 0. */
  readonly rotation?: Partial<CanvasRotation>;
  /** Its face turns to the camera (`facingFrame`). */
  readonly billboard?: boolean;
}

/**
 * Which way a camera looks, in canvas space: its screen's right and down,
 * and back from what it looks at toward the eye — three unit vectors, right
 * then down then back a right-handed frame, as x, y and z are.
 */
export interface CanvasAxes {
  readonly right: CanvasVec;
  readonly down: CanvasVec;
  readonly back: CanvasVec;
}

/** The top view's axes: the screen's right and down are x and y, and the eye is up z. */
export const TOP_AXES: CanvasAxes = Object.freeze({
  right: { x: 1, y: 0, z: 0 },
  down: { x: 0, y: 1, z: 0 },
  back: { x: 0, y: 0, z: 1 },
});

/** The matrix that turns x, y and z into a camera's right, down and back. */
function axesMatrix({ right, down, back }: CanvasAxes): CanvasMatrix {
  return [right.x, down.x, back.x, right.y, down.y, back.y, right.z, down.z, back.z];
}

/**
 * A box placed in the canvas: its centre, half its extent along each of its
 * own axes, and the matrix that turns its axes into the canvas's.
 */
export interface CanvasFrame {
  readonly centre: CanvasVec;
  readonly half: CanvasVec;
  readonly matrix: CanvasMatrix;
}

/** A box's turn, every angle given (an absent one is 0). */
export function boxRotation(box: CanvasBox): CanvasRotation {
  const r = box.rotation;
  return { x: r?.x ?? 0, y: r?.y ?? 0, z: r?.z ?? 0 };
}

/** How far a box rises: never below 0. */
const depthOf = (box: CanvasBox) => Math.max(0, box.depth ?? 0);

/** `box`'s frame, with its base at `base` (its own `z` unless a caller raises it). */
export function boxFrame(box: CanvasBox, base = box.z ?? 0): CanvasFrame {
  const depth = depthOf(box);
  return {
    centre: { x: box.x + box.width / 2, y: box.y + box.height / 2, z: base + depth / 2 },
    half: { x: box.width / 2, y: box.height / 2, z: depth / 2 },
    matrix: rotationMatrix(boxRotation(box)),
  };
}

/** A point given in the box's own frame, in the canvas. */
export function boxToWorld(frame: CanvasFrame, local: CanvasVec): CanvasVec {
  const { centre } = frame;
  const turned = apply(frame.matrix, local);
  return { x: centre.x + turned.x, y: centre.y + turned.y, z: centre.z + turned.z };
}

/** A canvas point in the box's own frame. */
export function boxToLocal(frame: CanvasFrame, world: CanvasVec): CanvasVec {
  const { centre } = frame;
  const offset = { x: world.x - centre.x, y: world.y - centre.y, z: world.z - centre.z };
  return apply(transpose(frame.matrix), offset);
}

/** A direction given in the box's own frame, in the canvas. */
export function directionToWorld(frame: CanvasFrame, local: CanvasVec): CanvasVec {
  return apply(frame.matrix, local);
}

/** A canvas direction in the box's own frame. */
export function directionToLocal(frame: CanvasFrame, world: CanvasVec): CanvasVec {
  return apply(transpose(frame.matrix), world);
}

/**
 * A flat box's frame as a camera looking along `axes` sees it face-on: its
 * footprint stood square to the screen, its top to the screen's top, rising
 * from where it lies — the centre over the footprint's centre, raised by
 * half its height as far as the view is tipped toward level, so its lower
 * edge stays on its plane. From the top it is its footprint; level with
 * the floor, it stands up from it. Its own turn is set aside: it faces the
 * camera whatever way it was turned.
 */
export function facingFrame(box: CanvasBox, axes: CanvasAxes, base = box.z ?? 0): CanvasFrame {
  return {
    centre: {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      z: base + facingLift(box, axes),
    },
    half: { x: box.width / 2, y: box.height / 2, z: 0 },
    matrix: axesMatrix(axes),
  };
}

/**
 * How far a facing box's centre rises off its plane for a camera looking
 * along `axes`: half its height, as far as the view is tipped toward level
 * (`facingFrame`). A number, so a renderer turning billboards every frame
 * reads it with nothing made.
 */
export function facingLift(box: CanvasBox, axes: CanvasAxes): number {
  return (-axes.down.z * box.height) / 2;
}

/** How far in front of a solid its standing face hangs, canvas units: clear of its surface. */
const FRONT_GAP = 1;

/**
 * How far a standing face stands from its box's centre toward the eye along
 * `back`: the box's reach that way — each of its half-extents along its own
 * axes (the matrix's columns) — and a hair (`frontFrame`). A number, as
 * `facingLift` is.
 */
export function frontReach(frame: CanvasFrame, back: CanvasVec): number {
  const { half, matrix: m } = frame;
  return (
    half.x * Math.abs(m[0] * back.x + m[3] * back.y + m[6] * back.z) +
    half.y * Math.abs(m[1] * back.x + m[4] * back.y + m[7] * back.z) +
    half.z * Math.abs(m[2] * back.x + m[5] * back.y + m[8] * back.z) +
    FRONT_GAP
  );
}

/**
 * A solid's face stood in front of it for a camera looking along `axes`:
 * its footprint's size, square to the screen, centred on the box's centre
 * and brought toward the eye until the whole box is behind it (the box's
 * reach along `back`), so its body never covers it. Where a sphere's or a
 * cone's label shows, having no flat top to lie on (`faceStands`).
 */
export function frontFrame(box: CanvasBox, axes: CanvasAxes, base = box.z ?? 0): CanvasFrame {
  const frame = boxFrame(box, base);
  const { centre, half } = frame;
  const { back } = axes;
  const reach = frontReach(frame, back);
  return {
    centre: {
      x: centre.x + back.x * reach,
      y: centre.y + back.y * reach,
      z: centre.z + back.z * reach,
    },
    half: { x: half.x, y: half.y, z: 0 },
    matrix: axesMatrix(axes),
  };
}

/**
 * Whether an item is drawn and picked facing the camera: a flat billboard.
 * A solid billboard keeps its body as it is turned, and only its face stands
 * (`faceStands`).
 */
export function facesCamera(box: CanvasBox): boolean {
  return box.billboard === true && depthOf(box) === 0;
}

/**
 * The frame an item is drawn and picked in by a camera looking along
 * `axes`: a flat billboard's footprint facing it (`facingFrame`), any other
 * item's box.
 */
export function itemFrame(box: CanvasBox, axes: CanvasAxes, base = box.z ?? 0): CanvasFrame {
  return facesCamera(box) ? facingFrame(box, axes, base) : boxFrame(box, base);
}

/**
 * A frame's eight corners in the canvas: its base, clockwise as its own top
 * view reads it from the top left, then its top in the same order (the same
 * four again when it is flat).
 */
export function frameCorners(frame: CanvasFrame): CanvasVec[] {
  const { half } = frame;
  const ring = (z: number) =>
    [
      { x: -half.x, y: -half.y, z },
      { x: half.x, y: -half.y, z },
      { x: half.x, y: half.y, z },
      { x: -half.x, y: half.y, z },
    ].map((local) => boxToWorld(frame, local));
  return [...ring(-half.z), ...ring(half.z)];
}

/**
 * A box's eight corners in the canvas: its base, clockwise as the top view
 * reads it from the top left, then its top in the same order (the same four
 * again when it is flat).
 */
export function boxCorners(box: CanvasBox, base = box.z ?? 0): CanvasVec[] {
  return frameCorners(boxFrame(box, base));
}

/** The box that bounds some corners along the canvas's own axes: its least and greatest corner. */
export interface CanvasBounds {
  readonly min: CanvasVec;
  readonly max: CanvasVec;
}

/**
 * The bounds of `boxes` along the canvas's axes: the least and the greatest
 * of their corners, however each is turned; null for none. What a frame
 * gathered round items spans, and what a canvas's relations compare.
 */
export function boxBounds(boxes: readonly CanvasBox[]): CanvasBounds | null {
  const corners = boxes.flatMap((box) => boxCorners(box));
  if (corners.length === 0) return null;
  const low = (axis: keyof CanvasVec) => Math.min(...corners.map((c) => c[axis]));
  const high = (axis: keyof CanvasVec) => Math.max(...corners.map((c) => c[axis]));
  return {
    min: { x: low("x"), y: low("y"), z: low("z") },
    max: { x: high("x"), y: high("y"), z: high("z") },
  };
}

/** The height of a box's highest corner: what is stacked on it stands there. */
export function boxTop(box: CanvasBox): number {
  return Math.max(...boxCorners(box).map((corner) => corner.z));
}

/**
 * The four corners of the plane a share `at` of the way up the box (0 its
 * base, 1 its top), in the canvas, clockwise as the top view reads the
 * footprint from its top left: where an item's face lies (`faceShare`).
 */
export function planeCorners(box: CanvasBox, at: number, base = box.z ?? 0): CanvasVec[] {
  const frame = boxFrame(box, base);
  const { half } = frame;
  const z = (at * 2 - 1) * half.z;
  return [
    { x: -half.x, y: -half.y, z },
    { x: half.x, y: -half.y, z },
    { x: half.x, y: half.y, z },
    { x: -half.x, y: half.y, z },
  ].map((local) => boxToWorld(frame, local));
}
