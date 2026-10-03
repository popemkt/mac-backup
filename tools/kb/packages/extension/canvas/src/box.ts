/**
 * An item's box in canvas space (plan 2026-10-02, decision 4): its footprint
 * `x, y, width, height` at the height of its base `z`, rising `depth` from
 * there. This module is the one place that says where a box's corners,
 * centre and own axes are, so every reader — the camera model's picking and
 * framing, both projections' drawing, edge anchors, snapping — places an
 * item the same way.
 *
 * A box has its own frame: the origin at the box's centre and its axes
 * along its width, its height and its depth. A point given in that frame
 * (`local`) and the same point in the canvas (`world`) convert through
 * {@link boxToWorld} and {@link boxToLocal}.
 */

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
}

/** A box placed in the canvas: its centre, and half its extent along each of its own axes. */
export interface CanvasFrame {
  readonly centre: CanvasVec;
  readonly half: CanvasVec;
}

/** How far a box rises: never below 0. */
const depthOf = (box: CanvasBox) => Math.max(0, box.depth ?? 0);

/** `box`'s frame, with its base at `base` (its own `z` unless a caller raises it). */
export function boxFrame(box: CanvasBox, base = box.z ?? 0): CanvasFrame {
  const depth = depthOf(box);
  return {
    centre: { x: box.x + box.width / 2, y: box.y + box.height / 2, z: base + depth / 2 },
    half: { x: box.width / 2, y: box.height / 2, z: depth / 2 },
  };
}

/** A point given in the box's own frame, in the canvas. */
export function boxToWorld(frame: CanvasFrame, local: CanvasVec): CanvasVec {
  const { centre } = frame;
  return { x: centre.x + local.x, y: centre.y + local.y, z: centre.z + local.z };
}

/** A canvas point in the box's own frame. */
export function boxToLocal(frame: CanvasFrame, world: CanvasVec): CanvasVec {
  const { centre } = frame;
  return { x: world.x - centre.x, y: world.y - centre.y, z: world.z - centre.z };
}

/** A direction given in the box's own frame, in the canvas. */
export function directionToWorld(_frame: CanvasFrame, local: CanvasVec): CanvasVec {
  return local;
}

/** A canvas direction in the box's own frame. */
export function directionToLocal(_frame: CanvasFrame, world: CanvasVec): CanvasVec {
  return world;
}

/**
 * A box's eight corners in the canvas: its base, clockwise as the top view
 * reads it from the top left, then its top in the same order (the same four
 * again when it is flat).
 */
export function boxCorners(box: CanvasBox, base = box.z ?? 0): CanvasVec[] {
  const frame = boxFrame(box, base);
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

/** The height of a box's highest point: what is stacked on it stands there. */
export function boxTop(box: CanvasBox): number {
  return Math.max(...boxCorners(box).map((corner) => corner.z));
}
