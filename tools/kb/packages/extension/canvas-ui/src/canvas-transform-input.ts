/**
 * How the pointer and the keyboard make one `CanvasTransform` (plan
 * 2026-10-02, decisions 9 and 10): a grab carries items, a rotate turns
 * them, a scale stretches them and an extrude grows their depth, each held
 * to a constraint — one axis, or the plane across one, along the canvas's
 * axes or the lead item's own — or set exactly by a typed value. Every
 * transform the pointer makes is one of these: a drag on a card is a grab
 * held to the floor plan, Alt-drag is a grab held to Z, the top-view rotate
 * handle is a rotate about Z, and Blender's modal G, R, S and E are the
 * same inputs with no button held (`keyInput` is their keyboard).
 *
 * Pure: the pointer is read through the camera model, so one input means the
 * same thing in both projections and from any orbit.
 */
import {
  IDENTITY,
  axisAngleOf,
  canvasDepth,
  canvasTop,
  coversFromAbove,
  paintOrder,
  stillAbout,
  turnAbout,
  type CanvasMatrix,
  type CanvasNode,
  type CanvasTransform,
  type CanvasVec,
} from "@kb/canvas";
import {
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
export type CanvasAxis = "x" | "y" | "z";

const AXES: readonly CanvasAxis[] = ["x", "y", "z"];

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

/** What an input does: carry, turn, stretch, or grow depth. */
export type TransformMode = "grab" | "rotate" | "scale" | "extrude";

/**
 * A transform under way as the pointer makes it. Unconstrained, a grab
 * carries across the floor plan, a rotate turns about the axis that points
 * at the eye (Z from the top) and a scale stretches every way alike; an
 * extrude always grows along the lead item's own Z.
 */
export interface TransformInput {
  readonly mode: TransformMode;
  readonly constraint: TransformConstraint | null;
  /** What the items turn and stretch about. */
  readonly pivot: CanvasVec;
  /** The lead item's own axes, which local space and an extrude run along. */
  readonly own: CanvasMatrix;
  /** The point a grab holds: its plane passes through it. */
  readonly anchor: CanvasVec;
  /** Where the pointer was when the input began, on screen. */
  readonly from: CanvasPoint;
  /** A value typed on the keyboard, as typed; while it reads as a number it sets the transform. */
  readonly typed: string;
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

const ZERO: CanvasVec = { x: 0, y: 0, z: 0 };
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

/** The typed value, when what was typed reads as a number. */
function typedValue(input: TransformInput): number | null {
  if (input.typed === "" || input.typed === "-") return null;
  const value = Number(input.typed);
  return Number.isFinite(value) ? value : null;
}

/** Whether a typed value sets the transform (and the pointer and snapping have no say). */
export function isTyped(input: TransformInput): boolean {
  return typedValue(input) !== null;
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
 * The items a transform leaves where they are, read once when it begins:
 * in paint order (what a carry is read against, and snaps to and stands
 * on), and whether any is a solid (with none, there is no top to read).
 */
export interface TransformGround {
  readonly items: readonly CanvasNode[];
  readonly solid: boolean;
}

/** The ground a transform of everything but the items `moving` names stands on, in `nodes`. */
export function groundOf(
  nodes: readonly CanvasNode[],
  moving: ReadonlySet<string>,
): TransformGround {
  const items = paintOrder(nodes.filter((node) => !moving.has(node.id)));
  return { items, solid: items.some((item) => canvasDepth(item) > 0) };
}

/**
 * Where a carry across the floor plan has the pointer: where it visibly is —
 * on the top of a solid it is over (one of `ground`'s, which it does not
 * carry), which is how an item is carried onto another — and otherwise on
 * the plane at height `z`.
 */
function carryPoint(
  camera: TransformCamera,
  at: CanvasPoint,
  z: number,
  ground: TransformGround,
): CanvasVec | null {
  const { view, size } = camera;
  if (!ground.solid) return screenToPlane(view, size, at, z);
  const id = hitTest(ground.items, view, size, at);
  const under = ground.items.find((item) => item.id === id);
  if (under !== undefined && canvasDepth(under) > 0) {
    const top = screenToPlane(view, size, at, canvasTop(under));
    if (top !== null && coversFromAbove(under, top)) return top;
  }
  return screenToPlane(view, size, at, z);
}

/**
 * The axis a typed value runs along: the constraint's axis, the first axis
 * of a constraint's plane, or (unconstrained) X — Blender's first field.
 */
// A typed value is one field: Blender's Tab to the next axis's field, and
// typed expressions, are not built.
// GAP [[01M420HFRQHBNYSPD0KCMJZ0Y7]]
function typedAxis(input: TransformInput): CanvasVec {
  const { constraint } = input;
  if (constraint === null) return axisOf(IDENTITY, "x");
  const axis = constraint.plane ? (constraint.axis === "x" ? "y" : "x") : constraint.axis;
  return axisOf(inputAxes(input), axis);
}

/** How far a grab has carried, with the pointer at `at`; null where its plane is edge-on. */
function grabMove(
  input: TransformInput,
  at: CanvasPoint,
  camera: TransformCamera,
  ground: TransformGround,
): CanvasVec | null {
  const typed = typedValue(input);
  if (typed !== null) return plus(ZERO, typedAxis(input), typed);
  const { constraint, anchor, from } = input;
  if (constraint === null) {
    const start = screenToPlane(camera.view, camera.size, from, anchor.z);
    const now = carryPoint(camera, at, anchor.z, ground);
    return start === null || now === null ? null : { x: now.x - start.x, y: now.y - start.y, z: 0 };
  }
  const dir = axisOf(inputAxes(input), constraint.axis);
  if (!constraint.plane) return plus(ZERO, dir, alongAxis(camera, anchor, dir, from, at));
  const start = onPlane(camera, from, anchor, dir);
  const now = onPlane(camera, at, anchor, dir);
  return start === null || now === null ? null : plus(now, start, -1);
}

/** The pointer's bearing about a screen point, radians (clockwise, as screen y runs down). */
const bearing = (about: CanvasPoint, at: CanvasPoint) => Math.atan2(at.y - about.y, at.x - about.x);

/** The axis a rotate turns about: the constraint's (a plane's turns about the axis across it), or toward the eye. */
function turnAxis(input: TransformInput, view: CanvasView): CanvasVec {
  const { constraint } = input;
  return constraint === null ? towardEye(view) : axisOf(inputAxes(input), constraint.axis);
}

/**
 * The turn a rotate makes with the pointer at `at`: by how far the pointer
 * has swung round the pivot on screen, clockwise turning clockwise as the
 * eye sees it; or by the degrees typed, about the same axis.
 */
function rotateTurn(
  input: TransformInput,
  at: CanvasPoint,
  camera: TransformCamera,
): CanvasMatrix | null {
  const axis = turnAxis(input, camera.view);
  const typed = typedValue(input);
  if (typed !== null) return turnAbout(axis, (typed * Math.PI) / 180);
  const centre = projectPoint(camera.view, camera.size, input.pivot);
  if (centre === null) return null;
  const swing = bearing(centre, at) - bearing(centre, input.from);
  return turnAbout(axis, dot(axis, towardEye(camera.view)) < 0 ? -swing : swing);
}

/** The least distance from the pivot a scale reads the pointer at, screen pixels. */
const SCALE_REACH = 8;

/**
 * The stretch a scale makes: the pointer's distance from the pivot on
 * screen over its distance where the scale began (or the factor typed),
 * along the constraint's axis, across its plane, or every way alike.
 */
function scaleStretch(
  input: TransformInput,
  at: CanvasPoint,
  camera: TransformCamera,
): CanvasVec | null {
  let factor = typedValue(input);
  if (factor === null) {
    const centre = projectPoint(camera.view, camera.size, input.pivot);
    if (centre === null) return null;
    const reach = (p: CanvasPoint) =>
      Math.max(SCALE_REACH, Math.hypot(p.x - centre.x, p.y - centre.y));
    factor = reach(at) / reach(input.from);
  }
  const f = factor;
  const { constraint } = input;
  const on = (axis: CanvasAxis) =>
    constraint === null || (constraint.axis === axis) !== constraint.plane ? f : 1;
  return { x: on("x"), y: on("y"), z: on("z") };
}

/** How far an extrude grows the lead item's depth: the pointer's travel along its own Z, or the length typed. */
function extrudeBy(input: TransformInput, at: CanvasPoint, camera: TransformCamera): number {
  const typed = typedValue(input);
  if (typed !== null) return typed;
  return alongAxis(camera, input.pivot, axisOf(input.own, "z"), input.from, at);
}

/**
 * The transform `input` makes with the pointer at `at`, read through
 * `camera`, over `ground`: the items it does not move (a carry stands on
 * their tops). Null where the pointer cannot be read (its plane edge-on).
 */
export function transformAt(
  input: TransformInput,
  at: CanvasPoint,
  camera: TransformCamera,
  ground: TransformGround,
): CanvasTransform | null {
  const still = { ...stillAbout(input.pivot), axes: inputAxes(input) };
  switch (input.mode) {
    case "grab": {
      const move = grabMove(input, at, camera, ground);
      return move === null ? null : { ...still, move };
    }
    case "rotate": {
      const turn = rotateTurn(input, at, camera);
      return turn === null ? null : { ...still, turn };
    }
    case "scale": {
      const stretch = scaleStretch(input, at, camera);
      return stretch === null ? null : { ...still, stretch };
    }
    case "extrude":
      return { ...still, extrude: extrudeBy(input, at, camera) };
    default:
      return null;
  }
}

/** A key pressed during a modal transform (plan decision 9's keymap). */
export type TransformKey =
  /** X, Y or Z: hold to that axis; with Shift, to the plane across it. */
  | { readonly kind: "axis"; readonly axis: CanvasAxis; readonly plane: boolean }
  /** A digit, `.`, `-` (which negates) or Backspace: the typed value. */
  | { readonly kind: "type"; readonly key: string }
  /** G, R or S: switch to grab, rotate or scale. */
  | { readonly kind: "mode"; readonly mode: Exclude<TransformMode, "extrude"> };

/**
 * The constraint after pressing `axis` (`plane` with Shift): the same key
 * again goes from the canvas's axes to the lead item's own, and a third
 * time lets go (Blender's cycle); another key holds to that axis afresh.
 */
function nextConstraint(
  current: TransformConstraint | null,
  axis: CanvasAxis,
  plane: boolean,
): TransformConstraint | null {
  if (current?.axis !== axis || current.plane !== plane) return { axis, plane, space: "global" };
  return current.space === "global" ? { ...current, space: "local" } : null;
}

/** `typed` after `key`: a digit or one `.` appends, `-` negates, Backspace takes the last back. */
function nextTyped(typed: string, key: string): string {
  if (key === "Backspace") return typed.slice(0, -1);
  if (key === "-") return typed.startsWith("-") ? typed.slice(1) : `-${typed}`;
  if (key === "." && typed.includes(".")) return typed;
  return /^[\d.]$/.test(key) ? typed + key : typed;
}

/**
 * `input` after `key`, with the pointer at `at`. A new mode starts afresh
 * from there (Blender's G, R and S switch, setting the last one aside); an
 * extrude has no axes to hold to.
 */
export function keyInput(
  input: TransformInput,
  key: TransformKey,
  at: CanvasPoint,
): TransformInput {
  switch (key.kind) {
    case "axis":
      if (input.mode === "extrude") return input;
      return { ...input, constraint: nextConstraint(input.constraint, key.axis, key.plane) };
    case "type":
      return { ...input, typed: nextTyped(input.typed, key.key) };
    case "mode":
      if (key.mode === input.mode) return input;
      return { ...input, mode: key.mode, constraint: null, typed: "", from: at };
    default:
      return input;
  }
}

/** An axis a modal transform runs along, as its guide line draws it through the pivot. */
export interface TransformGuide {
  readonly axis: CanvasAxis;
  readonly dir: CanvasVec;
}

/**
 * The axes `input` is held to, to draw through its pivot: the constraint's
 * axis, or the two across its plane; an extrude's is the lead item's own Z.
 */
export function transformGuides(input: TransformInput): readonly TransformGuide[] {
  if (input.mode === "extrude") return [{ axis: "z", dir: axisOf(input.own, "z") }];
  const { constraint } = input;
  if (constraint === null) return [];
  const axes = inputAxes(input);
  const held = constraint.plane ? AXES.filter((a) => a !== constraint.axis) : [constraint.axis];
  return held.map((axis) => ({ axis, dir: axisOf(axes, axis) }));
}

/** What a modal transform's readout says: what it does, what it is held to, and its value. */
export interface TransformReadout {
  readonly verb: string;
  readonly held: string | null;
  readonly value: string;
}

const VERBS = { grab: "Move", rotate: "Rotate", scale: "Scale", extrude: "Extrude" } as const;

/** A number as the readout shows it: to two places, trailing zeros dropped. */
const shown = (v: number) => `${Math.round(v * 100) / 100 + 0}`;

/** What `applied` (the transform the preview shows) means, for the readout. */
function valueOf(input: TransformInput, applied: CanvasTransform, view: CanvasView): string {
  const { constraint } = input;
  switch (input.mode) {
    case "grab": {
      const { move } = applied;
      if (constraint !== null && !constraint.plane) return shown(dot(move, typedAxis(input)));
      return `x ${shown(move.x)}  y ${shown(move.y)}  z ${shown(move.z)}`;
    }
    case "rotate": {
      const { axis, angle } = axisAngleOf(applied.turn);
      const sign = dot(axis, turnAxis(input, view)) < 0 ? -1 : 1;
      return `${shown((sign * angle * 180) / Math.PI)}°`;
    }
    case "scale": {
      const { x, y, z } = applied.stretch;
      return `×${shown([x, y, z].find((f) => f !== 1) ?? 1)}`;
    }
    case "extrude":
      return `${applied.extrude >= 0 ? "+" : ""}${shown(applied.extrude)}`;
    default:
      return "";
  }
}

/**
 * The readout of a modal transform: its verb, what it is held to ("X",
 * "plane YZ", "local Z"), and its value — the typed text while there is
 * some (with a caret), else what the preview shows.
 */
export function transformReadout(
  input: TransformInput,
  applied: CanvasTransform | null,
  view: CanvasView,
): TransformReadout {
  const { constraint } = input;
  const across = (axis: CanvasAxis) =>
    AXES.filter((a) => a !== axis)
      .join("")
      .toUpperCase();
  const held =
    constraint === null
      ? null
      : `${constraint.space === "local" ? "local " : ""}${
          constraint.plane ? `plane ${across(constraint.axis)}` : constraint.axis.toUpperCase()
        }`;
  const value =
    input.typed !== ""
      ? `${input.typed}▏`
      : valueOf(input, applied ?? stillAbout(input.pivot), view);
  return { verb: VERBS[input.mode], held, value };
}
