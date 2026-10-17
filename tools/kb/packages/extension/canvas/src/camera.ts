/**
 * A canvas's camera: which projection a view of it opens in, and the 3D pose
 * it was last looked at from. It is view state, not content: it is a setting
 * of the canvas view node showing the canvas (`./view.ts`, DESIGN.md →
 * Canvas documents → Camera), so two views of one canvas each keep their
 * own, and writing it never rewrites the document. No camera is 2D, today's
 * orthographic canvas.
 *
 * A view node holds it as two fields: the projection, one of the projection
 * field's option nodes, and the pose as one JSON value. Documents written
 * before it moved carry it under their own `camera` key, which the
 * document keeps as an unknown field until `ext.canvas.camera.migrate`
 * moves it onto the canvas's view node (`parseLegacyCamera`).
 */
import type { NodeId, NodeProps, PropValue } from "@kb/model";
import { isRecord } from "./fields.ts";
import { CANVAS_IDS } from "./ids.ts";

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
}

const POSE_KEYS = ["x", "y", "z", "zoom", "yaw", "pitch"] as const;
/** A lens no camera could hold, degrees: it is read as no lens at all. */
const MAX_FOV = 179;

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

/** A pose as written: its six numbers, then its lens when it has one. */
function emitPose(pose: CanvasPose): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of POSE_KEYS) out[key] = pose[key];
  if (pose.fov !== undefined) out.fov = pose.fov;
  return out;
}

/** Each projection's option node: the projection field's children. */
const PROJECTION_OPTIONS: Record<CanvasProjectionKind, NodeId> = {
  "2d": CANVAS_IDS.canvasProjection2d,
  "3d": CANVAS_IDS.canvasProjection3d,
};

/** A pose as one JSON value, or undefined when the value holds none. */
function poseOfValue(value: PropValue | undefined): CanvasPose | undefined {
  if (value?.t !== "str") return undefined;
  try {
    return parsePose(JSON.parse(value.v));
  } catch {
    return undefined;
  }
}

/**
 * The camera a canvas view node's props hold, or undefined when they name
 * no projection kb knows. A value it cannot read goes to `report`.
 */
export function readCanvasCamera(
  props: NodeProps,
  report: (warning: string) => void = () => {},
): CanvasCamera | undefined {
  const [named] = props[CANVAS_IDS.canvasProjectionField] ?? [];
  if (named === undefined) return undefined;
  const projection = PROJECTIONS.find(
    (p) => named.t === "ref" && PROJECTION_OPTIONS[p] === named.v,
  );
  if (projection === undefined) {
    report(`${CANVAS_IDS.canvasProjectionField}: ${JSON.stringify(named)} names no projection`);
    return undefined;
  }
  const [stored] = props[CANVAS_IDS.canvasPoseField] ?? [];
  const pose = poseOfValue(stored);
  if (stored !== undefined && pose === undefined)
    report(`${CANVAS_IDS.canvasPoseField}: ${JSON.stringify(stored)} is no pose`);
  return pose === undefined ? { projection } : { projection, pose };
}

/** The props a canvas view node holds `camera` as; no camera is none. */
export function canvasCameraProps(camera: CanvasCamera | undefined): Record<NodeId, PropValue[]> {
  if (camera === undefined) return {};
  const props: Record<NodeId, PropValue[]> = {
    [CANVAS_IDS.canvasProjectionField]: [{ t: "ref", v: PROJECTION_OPTIONS[camera.projection] }],
  };
  if (camera.pose !== undefined)
    props[CANVAS_IDS.canvasPoseField] = [{ t: "str", v: JSON.stringify(emitPose(camera.pose)) }];
  return props;
}

/** The fields a camera is written in: what writing a camera replaces on a view node. */
export const CANVAS_CAMERA_FIELDS: readonly NodeId[] = [
  CANVAS_IDS.canvasProjectionField,
  CANVAS_IDS.canvasPoseField,
];

/** The key a document written before the camera moved carries it under. */
export const LEGACY_CAMERA_KEY = "camera";

/**
 * A camera as a document's own `camera` key held it before it moved onto
 * the view node: `{projection, pose?}`, or undefined when it is not one.
 */
export function parseLegacyCamera(raw: unknown): CanvasCamera | undefined {
  if (!isRecord(raw)) return undefined;
  const projection = PROJECTIONS.find((p) => p === raw.projection);
  if (projection === undefined) return undefined;
  const pose = parsePose(raw.pose);
  return pose === undefined ? { projection } : { projection, pose };
}

/** The projection a camera opens in; no camera is 2D. */
export function projectionOf(camera: CanvasCamera | undefined): CanvasProjectionKind {
  return camera?.projection ?? "2d";
}

/**
 * `camera` opening in `projection`, looked at from `pose` when one is given.
 */
export function cameraLookingFrom(
  camera: CanvasCamera | undefined,
  projection: CanvasProjectionKind,
  pose?: CanvasPose,
): CanvasCamera {
  const next: CanvasCamera = { ...camera, projection };
  return pose === undefined ? next : { ...next, pose };
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
