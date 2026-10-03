/**
 * How an item turns (plan 2026-10-02, decision 4): its `rotation`, in
 * degrees about its box's centre, and the one order the three angles apply
 * in, which this module owns. Every reader — the camera model, both
 * projections, the gizmo bridge, snapping — turns an item through
 * {@link rotationMatrix} and reads a turn back through
 * {@link rotationOfMatrix}, so no second statement of the order exists.
 *
 * The order is Blender's XYZ Euler: about x first, then y, then z, each
 * about the canvas's own fixed axes, so the matrix is `Rz · Ry · Rx`. A turn
 * about z therefore always spins the item about the vertical, whatever it is
 * tilted by, which is what a top-view rotate handle does.
 *
 * Angles are right-handed in canvas coordinates. Because y runs down the
 * page, a positive turn about z is clockwise as the top view shows it — the
 * same sense as CSS `rotate`, whose `rotateZ` `rotateY` `rotateX` compose to
 * exactly this matrix in the top view's own axes.
 */
import type { CanvasVec } from "./box.ts";

/** An item's turn, degrees about its box's centre: about x, then y, then z (Blender's XYZ Euler). */
export interface CanvasRotation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A 3 × 3 matrix, row by row. */
export type CanvasMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export const NO_ROTATION: CanvasRotation = Object.freeze({ x: 0, y: 0, z: 0 });

export const IDENTITY: CanvasMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const RAD = Math.PI / 180;

/** Whether a turn leaves the item as it was. */
export function isUnrotated(r: CanvasRotation): boolean {
  return r.x === 0 && r.y === 0 && r.z === 0;
}

/** `m`'s entry at `row`, `col`. */
const at = (m: CanvasMatrix, row: number, col: number) => m[row * 3 + col] ?? 0;

/** `a · b`. */
export function multiply(a: CanvasMatrix, b: CanvasMatrix): CanvasMatrix {
  const cell = (row: number, col: number) =>
    at(a, row, 0) * at(b, 0, col) + at(a, row, 1) * at(b, 1, col) + at(a, row, 2) * at(b, 2, col);
  return [
    cell(0, 0),
    cell(0, 1),
    cell(0, 2),
    cell(1, 0),
    cell(1, 1),
    cell(1, 2),
    cell(2, 0),
    cell(2, 1),
    cell(2, 2),
  ];
}

/** The inverse of a rotation: its transpose. */
export function transpose(m: CanvasMatrix): CanvasMatrix {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** `m · v`. */
export function apply(m: CanvasMatrix, v: CanvasVec): CanvasVec {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  };
}

/** The turn's matrix: `Rz · Ry · Rx`, x applied first. */
export function rotationMatrix(r: CanvasRotation): CanvasMatrix {
  if (isUnrotated(r)) return IDENTITY;
  const [cx, sx] = [Math.cos(r.x * RAD), Math.sin(r.x * RAD)];
  const [cy, sy] = [Math.cos(r.y * RAD), Math.sin(r.y * RAD)];
  const [cz, sz] = [Math.cos(r.z * RAD), Math.sin(r.z * RAD)];
  return [
    cz * cy,
    cz * sy * sx - sz * cx,
    cz * sy * cx + sz * sx,
    sz * cy,
    sz * sy * sx + cz * cx,
    sz * sy * cx - cz * sx,
    -sy,
    cy * sx,
    cy * cx,
  ];
}

/**
 * An angle as kb writes it: within (-180, 180], to a ten-thousandth of a
 * degree (finer than any gesture means, coarse enough that a round trip
 * through a matrix comes back the number it was).
 */
export function normalizeDegrees(d: number): number {
  const wrapped = ((((d + 180) % 360) + 360) % 360) - 180;
  const rounded = Math.round((wrapped === -180 ? 180 : wrapped) * 1e4) / 1e4;
  return rounded === 0 ? 0 : rounded;
}

/**
 * The turn a rotation matrix stands for, in this module's order. At the
 * gimbal lock (y at ±90°) only x ∓ z is defined; x takes all of it and z is 0.
 */
export function rotationOfMatrix(m: CanvasMatrix): CanvasRotation {
  const sy = -m[6];
  if (Math.abs(sy) > 1 - 1e-9) {
    const y = sy > 0 ? 90 : -90;
    // At y = 90° the middle row reads (0, cos(x − z), …) and m[1] = sin(x − z);
    // at y = -90°, cos(x + z) and -sin(x + z). z is folded into x.
    const x = Math.atan2(sy > 0 ? m[1] : -m[1], m[4]) / RAD;
    return { x: normalizeDegrees(x), y, z: 0 };
  }
  const x = Math.atan2(m[7], m[8]) / RAD;
  const y = Math.asin(Math.max(-1, Math.min(1, sy))) / RAD;
  const z = Math.atan2(m[3], m[0]) / RAD;
  return { x: normalizeDegrees(x), y: normalizeDegrees(y), z: normalizeDegrees(z) };
}

/** A turn of `radians` about the unit `axis` (right-handed). */
export function turnAbout(axis: CanvasVec, radians: number): CanvasMatrix {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const t = 1 - c;
  const { x, y, z } = axis;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ];
}

/** A rotation matrix as a turn about one axis: the axis (unit) and the angle, 0 to π radians. */
export function axisAngleOf(m: CanvasMatrix): { readonly axis: CanvasVec; readonly angle: number } {
  const cos = Math.max(-1, Math.min(1, (m[0] + m[4] + m[8] - 1) / 2));
  const angle = Math.acos(cos);
  if (angle < 1e-9) return { axis: { x: 0, y: 0, z: 1 }, angle: 0 };
  if (Math.PI - angle < 1e-6) {
    // A half turn: the axis is the column of (m + I) with the most in it.
    const xx = Math.sqrt(Math.max(0, (m[0] + 1) / 2));
    const yy = Math.sqrt(Math.max(0, (m[4] + 1) / 2));
    const zz = Math.sqrt(Math.max(0, (m[8] + 1) / 2));
    if (xx >= yy && xx >= zz) {
      return { axis: { x: xx, y: m[1] / (2 * xx), z: m[2] / (2 * xx) }, angle };
    }
    if (yy >= zz) return { axis: { x: m[1] / (2 * yy), y: yy, z: m[5] / (2 * yy) }, angle };
    return { axis: { x: m[2] / (2 * zz), y: m[5] / (2 * zz), z: zz }, angle };
  }
  const s = 2 * Math.sin(angle);
  return {
    axis: { x: (m[7] - m[5]) / s, y: (m[2] - m[6]) / s, z: (m[3] - m[1]) / s },
    angle,
  };
}
