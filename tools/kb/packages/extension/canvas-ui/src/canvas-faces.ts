/**
 * Where an item's face is, as a camera sees it, and what lands on one
 * (DESIGN-UI.md → Canvas): the plane a face is shown on — where it lies on
 * the item, or standing square to the camera — which a face's editor is laid
 * over in 3D, and where a placing tool puts an item: on the face of a frame
 * that stands, or on the floor. Built on the one camera model
 * (`canvas-camera`).
 */
import {
  boxToWorld,
  faceShare,
  faceStands,
  frontFrame,
  itemFrame,
  type CanvasFrame,
  type CanvasNode,
} from "@kb/canvas";
import {
  screenRay,
  screenToPlane,
  viewAxes,
  type CanvasPoint,
  type CanvasPoint3,
  type CanvasView,
  type ViewSize,
} from "./canvas-camera";

/**
 * The plane an item's face is shown on as `view` sees it, as its frame: a
 * flat billboard standing square to the camera, a solid's standing face in
 * front of it (`frontFrame`), and any other face where it lies on the item
 * (`faceShare`: a prism's top, a flat item's own plane), turned with it.
 * What a face's editor is laid over in 3D.
 */
export function faceFrameOf(item: CanvasNode, z: number, view: CanvasView): CanvasFrame {
  const axes = viewAxes(view);
  if (faceStands(item) && (item.depth ?? 0) > 0) return frontFrame(item, axes, z);
  const frame = itemFrame(item, axes, z);
  const lift = (faceShare(item) * 2 - 1) * frame.half.z;
  return {
    centre: boxToWorld(frame, { x: 0, y: 0, z: lift }),
    half: { x: frame.half.x, y: frame.half.y, z: 0 },
    matrix: frame.matrix,
  };
}

/** Where a placing tool puts an item: a point, and the face it lies on (null for the floor). */
export interface CanvasPlace {
  readonly at: CanvasPoint3;
  readonly face: CanvasFrame | null;
}

/**
 * Where a placing tool puts an item under `screen`: on the face of `frame`
 * (a frame it was pressed on) when that face does not lie flat facing up —
 * a frame stood up as a wall, or tipped — and otherwise on the floor, as
 * every placement before frames could stand. Null when the eye's ray meets
 * neither.
 */
export function placeUnder(
  view: CanvasView,
  size: ViewSize,
  screen: CanvasPoint,
  frame?: CanvasNode,
): CanvasPlace | null {
  const face = frame === undefined ? null : faceFrameOf(frame, frame.z ?? 0, view);
  if (face !== null && face.matrix[8] < 1 - 1e-9) {
    const at = screenToFace(view, size, screen, face);
    return at === null ? null : { at, face };
  }
  const at = screenToPlane(view, size, screen, 0);
  return at === null ? null : { at, face: null };
}

/**
 * The canvas point under `screen` on the plane of `face` (a face's frame,
 * `faceFrameOf`), however it stands: where a tool places on a frame stood up
 * as a wall. Null when the eye's ray runs along the plane or away from it.
 */
function screenToFace(
  view: CanvasView,
  size: ViewSize,
  screen: CanvasPoint,
  face: CanvasFrame,
): CanvasPoint3 | null {
  const { origin, dir } = screenRay(view, size, screen);
  const m = face.matrix;
  const normal = { x: m[2], y: m[5], z: m[8] };
  const across = normal.x * dir.x + normal.y * dir.y + normal.z * dir.z;
  if (Math.abs(across) < 1e-9) return null;
  const { centre } = face;
  const t =
    (normal.x * (centre.x - origin.x) +
      normal.y * (centre.y - origin.y) +
      normal.z * (centre.z - origin.z)) /
    across;
  if (!(t > 0)) return null;
  return { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t };
}
