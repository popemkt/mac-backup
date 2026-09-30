/**
 * A canvas's camera: which projection it opens in, and the 3D pose it was
 * last looked at from. It is the document's `camera` key, a JSON Canvas
 * extension field; absent means 2D, today's orthographic canvas.
 *
 * This is view state, not content: the undo history leaves it out, and a
 * second view of the same canvas would want a camera of its own. It lives
 * here, in one module the document only delegates to, because canvases are
 * not views yet; once view nodes exist it becomes that view's settings and
 * this module is what moves.
 */
// GAP [[01M3S5DD5W4B3BSZMA6DE8ZVP8]]
import { dropExtra } from "./extra.ts";

/** How a canvas is drawn: face-on and orthographic, or in perspective. */
export type CanvasProjectionKind = "2d" | "3d";

const PROJECTIONS = ["2d", "3d"] as const satisfies readonly CanvasProjectionKind[];

/**
 * A saved 3D pose, in the canvas's own space (x right, y down, z toward the
 * viewer): the point looked at, the zoom on the plane through it (screen
 * pixels per canvas unit), and the orbit about it in radians. Yaw turns about
 * the canvas's vertical axis; pitch tips its bottom edge toward the eye.
 */
export interface CanvasPose {
  x: number;
  y: number;
  z: number;
  zoom: number;
  yaw: number;
  pitch: number;
}

export interface CanvasCamera {
  projection: CanvasProjectionKind;
  pose?: CanvasPose;
  /** Unrecognized fields preserved for round-trip. */
  extra?: Record<string, unknown>;
}

const KNOWN_CAMERA_KEYS = new Set(["projection", "pose"]);
const POSE_KEYS = ["x", "y", "z", "zoom", "yaw", "pitch"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parsePose(raw: unknown): CanvasPose | undefined {
  if (!isRecord(raw)) return undefined;
  const { x, y, z, zoom, yaw, pitch } = raw;
  if (!finite(x) || !finite(y) || !finite(z) || !finite(yaw) || !finite(pitch)) return undefined;
  if (!finite(zoom) || zoom <= 0) return undefined;
  return { x, y, z, zoom, yaw, pitch };
}

/**
 * A camera read from a document's `camera` value, or undefined when it is not
 * one — the caller then keeps the raw value as an unknown field, so a camera
 * written by a newer kb survives an older one untouched.
 */
export function parseCanvasCamera(raw: unknown): CanvasCamera | undefined {
  if (!isRecord(raw)) return undefined;
  const projection = PROJECTIONS.find((p) => p === raw.projection);
  if (projection === undefined) return undefined;
  const camera: CanvasCamera = { projection };
  const pose = parsePose(raw.pose);
  if (pose) camera.pose = pose;
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_CAMERA_KEYS.has(k) || (k === "pose" && !pose)) extra[k] = v;
  }
  if (Object.keys(extra).length > 0) camera.extra = extra;
  return camera;
}

/** The camera as JSON. A known field wins over an unknown one of the same name. */
export function emitCanvasCamera(camera: CanvasCamera): Record<string, unknown> {
  const out: Record<string, unknown> = { ...camera.extra, projection: camera.projection };
  if (camera.pose) {
    const pose: Record<string, number> = {};
    for (const key of POSE_KEYS) pose[key] = camera.pose[key];
    out.pose = pose;
  }
  return out;
}

/** The projection a camera opens in; no camera is 2D. */
export function projectionOf(camera: CanvasCamera | undefined): CanvasProjectionKind {
  return camera?.projection ?? "2d";
}

/**
 * `camera` opening in `projection`, looked at from `pose` when one is given.
 * A pose written here supersedes one this version could not read.
 */
export function cameraLookingFrom(
  camera: CanvasCamera | undefined,
  projection: CanvasProjectionKind,
  pose?: CanvasPose,
): CanvasCamera {
  const next: CanvasCamera = { ...camera, projection };
  return pose === undefined ? next : dropExtra({ ...next, pose }, "pose");
}

/** How far two poses may differ and still be the same look, per component. */
const POSE_TOLERANCE = { place: 1e-3, turn: 1e-4, zoom: 1e-4 } as const;

const near = (p: number, q: number, tolerance: number) => Math.abs(p - q) <= tolerance;

/** The same look, to within what nobody could see: saving it again would only churn. */
export function posesAgree(a: CanvasPose | undefined, b: CanvasPose | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    near(a.x, b.x, POSE_TOLERANCE.place) &&
    near(a.y, b.y, POSE_TOLERANCE.place) &&
    near(a.z, b.z, POSE_TOLERANCE.place) &&
    near(a.yaw, b.yaw, POSE_TOLERANCE.turn) &&
    near(a.pitch, b.pitch, POSE_TOLERANCE.turn) &&
    near(a.zoom / b.zoom, 1, POSE_TOLERANCE.zoom)
  );
}
