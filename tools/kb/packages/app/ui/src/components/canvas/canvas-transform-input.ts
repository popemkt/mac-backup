/**
 * How the pointer makes one `CanvasTransform` (plan 2026-10-02, decisions 9
 * and 10): a grab carries items and a rotate turns them, each held to a
 * constraint — one axis, or the plane across one, along the canvas's axes
 * or the lead item's own. Every pointer-made transform is one of these: a
 * drag on a card is a grab held to the floor plan, Alt-drag is a grab held
 * to Z, and the top-view rotate handle is a rotate about Z.
 *
 * Pure: the pointer is read through the camera model, so one input means the
 * same thing in both projections and from any orbit.
 */
import {
  IDENTITY,
  canvasDepth,
  canvasTop,
  paintOrder,
  stillAbout,
  turnAbout,
  type CanvasMatrix,
  type CanvasNode,
  type CanvasTransform,
  type CanvasVec,
} from "@kb/canvas";
import {
  coversFromAbove,
  hitTest,
  projectPoint,
  screenAxes,
  screenRay,
  screenToPlane,
  type CanvasPoint,
  type CanvasView,
  type ViewSize,
} from "./canvas-camera";

/** One of the canvas's axes, or of an item's own. */
type CanvasAxis = "x" | "y" | "z";

/** Each axis's column in an axes matrix. */
const COLUMN = { x: 0, y: 1, z: 2 } as const satisfies { readonly [A in CanvasAxis]: number };

/**
 * What a transform is held to: one axis, or (`plane`) the plane across it,
 * which is every axis but that one; along the canvas's axes (`global`) or
 * the lead item's own (`local`).
 */
export interface TransformConstraint {
  readonly axis: CanvasAxis;
  readonly plane: boolean;
  readonly space: "global" | "local";
}

/** The canvas's Z axis: what Alt-drag holds a grab to. */
export const ALONG_Z: TransformConstraint = { axis: "z", plane: false, space: "global" };

/** What a pointer-made transform does. */
type TransformMode = "grab" | "rotate";

/**
 * A transform under way as the pointer makes it. Unconstrained, a grab
 * carries across the floor plan and a rotate turns about the axis that
 * points at the eye (Z from the top).
 */
export interface TransformInput {
  readonly mode: TransformMode;
  readonly constraint: TransformConstraint | null;
  /** What the items turn about. */
  readonly pivot: CanvasVec;
  /** The lead item's own axes, which local space runs along. */
  readonly own: CanvasMatrix;
  /** The point a grab holds: its plane passes through it. */
  readonly anchor: CanvasVec;
  /** Where the pointer was when the input began, on screen. */
  readonly from: CanvasPoint;
}

/** The camera the pointer is read through: the showing projection's. */
export interface TransformCamera {
  readonly view: CanvasView;
  readonly size: ViewSize;
}

/** The axes `input` runs along: the lead item's own in local space, else the canvas's. */
function inputAxes(input: TransformInput): CanvasMatrix {
  return input.constraint?.space === "local" ? input.own : IDENTITY;
}

/** Column `axis` of `axes`, a unit direction in canvas space. */
function axisOf(axes: CanvasMatrix, axis: CanvasAxis): CanvasVec {
  const i = COLUMN[axis];
  return { x: axes[i], y: axes[3 + i] ?? 0, z: axes[6 + i] ?? 0 };
}

const plus = (a: CanvasVec, b: CanvasVec, by = 1): CanvasVec => ({
  x: a.x + b.x * by,
  y: a.y + b.y * by,
  z: a.z + b.z * by,
});
const dot = (a: CanvasVec, b: CanvasVec) => a.x * b.x + a.y * b.y + a.z * b.z;

/** The direction from the focus toward the eye: what an unconstrained rotate turns about. */
function towardEye(view: CanvasView): CanvasVec {
  const axes = screenAxes(view);
  return { x: axes.x.toward, y: axes.y.toward, z: axes.z.toward };
}

/** Where the ray through `at` meets the plane through `anchor` across `normal`; null edge-on or behind. */
function onPlane(
  camera: TransformCamera,
  at: CanvasPoint,
  anchor: CanvasVec,
  normal: CanvasVec,
): CanvasVec | null {
  const { origin, dir } = screenRay(camera.view, camera.size, at);
  const facing = dot(dir, normal);
  if (Math.abs(facing) < 1e-6) return null;
  const t = dot(plus(anchor, origin, -1), normal) / facing;
  return t > 0 ? plus(origin, dir, t) : null;
}

/** How near edge-on an axis may be and still be followed on screen: its length there, per zoom. */
const EDGE_ON = 0.25;

/**
 * How far along `dir` (through `anchor`) the pointer has gone from `from`
 * to `at`: its travel read along the axis as the screen shows it (Blender's
 * reading). An axis seen nearly end-on is followed up the screen instead,
 * one unit per pixel at the zoom, as a lift from the top view is.
 */
function alongAxis(
  camera: TransformCamera,
  anchor: CanvasVec,
  dir: CanvasVec,
  from: CanvasPoint,
  at: CanvasPoint,
): number {
  const { view, size } = camera;
  const unit = 100 / view.zoom;
  const a = projectPoint(view, size, anchor);
  const b = projectPoint(view, size, plus(anchor, dir, unit));
  const raw = a === null || b === null ? null : { x: (b.x - a.x) / unit, y: (b.y - a.y) / unit };
  const seen =
    raw !== null && Math.hypot(raw.x, raw.y) >= EDGE_ON * view.zoom ? raw : { x: 0, y: -view.zoom };
  return ((at.x - from.x) * seen.x + (at.y - from.y) * seen.y) / (seen.x ** 2 + seen.y ** 2);
}

/**
 * Where a carry across the floor plan has the pointer: where it visibly is —
 * on the top of a solid it is over (one of `others`, which it does not
 * carry), which is how an item is carried onto another — and otherwise on
 * the plane at height `z`.
 */
function carryPoint(
  camera: TransformCamera,
  at: CanvasPoint,
  z: number,
  others: readonly CanvasNode[],
): CanvasVec | null {
  const { view, size } = camera;
  const id = hitTest(paintOrder(others), view, size, at);
  const under = others.find((item) => item.id === id);
  if (under !== undefined && canvasDepth(under) > 0) {
    const top = screenToPlane(view, size, at, canvasTop(under));
    if (top !== null && coversFromAbove(under, top)) return top;
  }
  return screenToPlane(view, size, at, z);
}

/** How far a grab has carried, with the pointer at `at`; null where its plane is edge-on. */
function grabMove(
  input: TransformInput,
  at: CanvasPoint,
  camera: TransformCamera,
  others: readonly CanvasNode[],
): CanvasVec | null {
  const { constraint, anchor, from } = input;
  if (constraint === null) {
    const start = screenToPlane(camera.view, camera.size, from, anchor.z);
    const now = carryPoint(camera, at, anchor.z, others);
    return start === null || now === null ? null : { x: now.x - start.x, y: now.y - start.y, z: 0 };
  }
  const dir = axisOf(inputAxes(input), constraint.axis);
  if (!constraint.plane)
    return plus({ x: 0, y: 0, z: 0 }, dir, alongAxis(camera, anchor, dir, from, at));
  const start = onPlane(camera, from, anchor, dir);
  const now = onPlane(camera, at, anchor, dir);
  return start === null || now === null ? null : plus(now, start, -1);
}

/** The pointer's bearing about a screen point, radians (clockwise, as screen y runs down). */
const bearing = (about: CanvasPoint, at: CanvasPoint) => Math.atan2(at.y - about.y, at.x - about.x);

/**
 * The turn a rotate makes with the pointer at `at`: by how far the pointer
 * has swung round the pivot on screen, clockwise turning clockwise as the
 * eye sees it — about the constraint's axis (a plane's turns about the axis
 * across it), or about the axis toward the eye.
 */
function rotateTurn(
  input: TransformInput,
  at: CanvasPoint,
  camera: TransformCamera,
): CanvasMatrix | null {
  const centre = projectPoint(camera.view, camera.size, input.pivot);
  if (centre === null) return null;
  const swing = bearing(centre, at) - bearing(centre, input.from);
  const eye = towardEye(camera.view);
  if (input.constraint === null) return turnAbout(eye, swing);
  const axis = axisOf(inputAxes(input), input.constraint.axis);
  return turnAbout(axis, dot(axis, eye) < 0 ? -swing : swing);
}

/**
 * The transform `input` makes with the pointer at `at`, read through
 * `camera`; `others` are the items it does not move (a carry stands on
 * their tops). Null where the pointer cannot be read (its plane edge-on).
 */
export function transformAt(
  input: TransformInput,
  at: CanvasPoint,
  camera: TransformCamera,
  others: readonly CanvasNode[],
): CanvasTransform | null {
  const still = { ...stillAbout(input.pivot), axes: inputAxes(input) };
  if (input.mode === "grab") {
    const move = grabMove(input, at, camera, others);
    return move === null ? null : { ...still, move };
  }
  const turn = rotateTurn(input, at, camera);
  return turn === null ? null : { ...still, turn };
}
