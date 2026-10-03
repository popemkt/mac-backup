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

/** How a canvas is drawn: from the top and orthographic, or in depth on a turntable. */
export type CanvasProjectionKind = "2d" | "3d";

const PROJECTIONS = ["2d", "3d"] as const satisfies readonly CanvasProjectionKind[];

/**
 * A camera pose, in the canvas's own space (the canvas plane is the floor: x
 * right and y down as the top view shows them, z up): the point looked at,
 * the zoom on the plane through it (screen pixels per canvas unit), the
 * turntable orbit about it in radians, and the lens. Yaw turns about z; pitch
 * runs from 0, looking straight down, to π/2, level with the floor. `fov` is
 * the vertical field of view in degrees, 0 orthographic; a pose saved before
 * it had one is seen through the 3D projection's perspective lens.
 */
export interface CanvasPose {
  x: number;
  y: number;
  z: number;
  zoom: number;
  yaw: number;
  pitch: number;
  fov?: number;
}

export interface CanvasCamera {
  projection: CanvasProjectionKind;
  pose?: CanvasPose;
  /** Unrecognized fields preserved for round-trip. */
  extra?: Record<string, unknown>;
}

const KNOWN_CAMERA_KEYS = new Set(["projection", "pose"]);
const POSE_KEYS = ["x", "y", "z", "zoom", "yaw", "pitch"] as const;
/** A lens no camera could hold, degrees: it is read as no lens at all. */
const MAX_FOV = 179;

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
  const pose: CanvasPose = { x, y, z, zoom, yaw, pitch };
  if (finite(raw.fov) && raw.fov >= 0 && raw.fov <= MAX_FOV) pose.fov = raw.fov;
  return pose;
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
    if (camera.pose.fov !== undefined) pose.fov = camera.pose.fov;
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
const POSE_TOLERANCE = { place: 1e-3, turn: 1e-4, zoom: 1e-4, lens: 1e-3 } as const;

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
    near(a.zoom / b.zoom, 1, POSE_TOLERANCE.zoom) &&
    (a.fov === undefined || b.fov === undefined
      ? a.fov === b.fov
      : near(a.fov, b.fov, POSE_TOLERANCE.lens))
  );
}
