/**
 * One transform of a set of items about a pivot (plan 2026-10-02, decision
 * 10): what a gizmo drag, a top-view rotate handle and, later, a modal
 * grab, scale or rotate each make, and the one place that applies it to an
 * item's record. Every item stays the record it is — its footprint, `z`,
 * `depth` and `rotation`, in world coordinates — so a transform rewrites
 * those numbers and nothing else.
 */
import { boxCorners, boxFrame, type CanvasBox, type CanvasVec } from "./box.ts";
import { withDepth, withElevation, withRotation, type CanvasNode } from "./doc.ts";
import {
  IDENTITY,
  apply,
  multiply,
  rotationOfMatrix,
  transpose,
  type CanvasMatrix,
} from "./rotation.ts";

/**
 * A transform about `pivot`: stretch along `stretch.axes` (its columns) by
 * `stretch.by`, then `turn`, then `move`, each about the pivot and in the
 * canvas's own axes.
 */
export interface CanvasTransform {
  readonly pivot: CanvasVec;
  readonly move: CanvasVec;
  readonly turn: CanvasMatrix;
  readonly stretch: { readonly axes: CanvasMatrix; readonly by: CanvasVec };
}

const ZERO: CanvasVec = { x: 0, y: 0, z: 0 };
const ONES: CanvasVec = { x: 1, y: 1, z: 1 };

/** A transform that leaves everything where it is, about `pivot`. */
export function stillAbout(pivot: CanvasVec): CanvasTransform {
  return { pivot, move: ZERO, turn: IDENTITY, stretch: { axes: IDENTITY, by: ONES } };
}

/** The smallest an item's footprint side may be stretched to, canvas units. */
const MIN_SIDE = 1;

/**
 * Where a set of items turns and stretches about: the centre of the box
 * that bounds them all (Blender's bounding box centre).
 */
export function selectionPivot(items: readonly CanvasBox[]): CanvasVec {
  const corners = items.flatMap((item) => boxCorners(item));
  if (corners.length === 0) return ZERO;
  const mid = (axis: keyof CanvasVec) => {
    const values = corners.map((c) => c[axis]);
    return (Math.min(...values) + Math.max(...values)) / 2;
  };
  return { x: mid("x"), y: mid("y"), z: mid("z") };
}

const same = (a: CanvasMatrix, b: CanvasMatrix) => a.every((v, i) => v === b[i]);
/**
 * A coordinate as a transform writes it: to a ten-thousandth of a unit, so
 * the float noise of turning there and back never lands in the document.
 */
const fine = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
const length = (v: CanvasVec) => Math.hypot(v.x, v.y, v.z);

/**
 * `node` transformed by `t`. Its centre moves as a point does; its own axes
 * turn with `turn`; and each of its sides stretches by how far `stretch`
 * lengthens that side's axis (a stretch across a turned item's axes is
 * taken as that, not as a shear its record could not hold). An item `t`
 * does not turn keeps its `rotation` exactly as written.
 */
// A stretch along axes that are not the item's own cannot shear its record,
// so each side stretches by how far its own axis grows.
// GAP [stretch-across-turned-axes]
export function transformItem<N extends CanvasNode>(node: N, t: CanvasTransform): N {
  const frame = boxFrame(node);
  const { axes, by } = t.stretch;
  const stretch = multiply(multiply(axes, [by.x, 0, 0, 0, by.y, 0, 0, 0, by.z]), transpose(axes));
  const from = {
    x: frame.centre.x - t.pivot.x,
    y: frame.centre.y - t.pivot.y,
    z: frame.centre.z - t.pivot.z,
  };
  const to = apply(t.turn, apply(stretch, from));
  const centre = {
    x: t.pivot.x + t.move.x + to.x,
    y: t.pivot.y + t.move.y + to.y,
    z: t.pivot.z + t.move.z + to.z,
  };
  const column = (i: 0 | 1 | 2): CanvasVec => ({
    x: frame.matrix[i],
    y: frame.matrix[3 + i] ?? 0,
    z: frame.matrix[6 + i] ?? 0,
  });
  const factor = (i: 0 | 1 | 2) => length(apply(stretch, column(i)));
  const width = fine(Math.max(MIN_SIDE, node.width * factor(0)));
  const height = fine(Math.max(MIN_SIDE, node.height * factor(1)));
  const depth = fine(frame.half.z * 2 * factor(2));
  const x = fine(centre.x - width / 2);
  const y = fine(centre.y - height / 2);
  const placed = withElevation(
    withDepth({ ...node, x, y, width, height }, depth),
    fine(centre.z - depth / 2),
  );
  return same(t.turn, IDENTITY)
    ? placed
    : withRotation(placed, rotationOfMatrix(multiply(t.turn, frame.matrix)));
}
