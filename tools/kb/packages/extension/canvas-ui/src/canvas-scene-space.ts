/**
 * Canvas space and three's world, the one bridge between them: canvas y runs
 * down the top view and three's y up it, so a point maps by flipping y, and a
 * rotation matrix `m` maps to `F · m · F` (F the y flip), which negates the
 * entries that mix y with x or z. Every 3D canvas module that hands a point,
 * a turn or a ray across goes through here.
 */
import type { Matrix4, Vector3 } from "three/webgpu";
import type { CanvasAxes, CanvasMatrix, CanvasVec } from "@kb/canvas";

/** A canvas point (or direction) in three's world, into `out`. */
export function toThree(p: CanvasVec, out: Vector3): Vector3 {
  return out.set(p.x, -p.y, p.z);
}

/** A point (or direction) of three's world in canvas space. */
export function fromThree(v: Vector3): CanvasVec {
  return { x: v.x, y: -v.y, z: v.z };
}

/** A canvas rotation matrix (row by row) as three's, into `out`. */
export function matrixToThree(m: CanvasMatrix, out: Matrix4): Matrix4 {
  const [a, b, c, d, e, f, g, h, i] = m;
  return out.set(a, -b, c, 0, -d, e, -f, 0, g, -h, i, 0, 0, 0, 0, 1);
}

/**
 * The turn that takes x, y and z to a camera's right, down and back (what a
 * face square to it is turned by), as three's, into `out` — the matrix
 * `matrixToThree` would make of them, with nothing made on the way.
 */
export function axesToThree({ right: r, down: d, back: b }: CanvasAxes, out: Matrix4): Matrix4 {
  return out.set(r.x, -d.x, b.x, 0, -r.y, d.y, -b.y, 0, r.z, -d.z, b.z, 0, 0, 0, 0, 1);
}

/** Three's rotation (the upper 3 × 3 of `m`) as a canvas rotation matrix, row by row. */
export function matrixFromThree(m: Matrix4): CanvasMatrix {
  // Three keeps its elements column by column.
  const [a, d, g, , b, e, h, , c, f, i] = m.elements;
  return [a, -b, c, -d, e, -f, g, -h, i];
}
