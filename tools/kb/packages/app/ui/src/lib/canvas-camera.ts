/**
 * The canvas camera: the one model of how canvas space meets the screen, which
 * every canvas projection draws, hit-tests and moves through
 * (DESIGN-UI.md → Canvas → Projections).
 *
 * Canvas space is the document's: x to the right, y down, and z out of the
 * page toward the viewer, in the document's units. A view looks at a focus
 * point from an orbit (`yaw`, `pitch`; both 0 is face-on) through a field of
 * view, and `zoom` is how many screen pixels one canvas unit covers on the
 * plane through the focus that faces the camera. `fov` 0 is orthographic.
 *
 * The 2D projection is this camera face-on and orthographic, which is exactly
 * a CSS `translate(pan) scale(zoom)`: {@link viewOfPan} and {@link panOfView}
 * are the bridge, and every 2D conversion goes through them. The 3D
 * projection is the same camera in perspective. Because `zoom` is measured on
 * the focus plane, widening the field of view at a fixed zoom pulls the eye
 * in to keep that plane the same size on screen — the dolly zoom that turns
 * one projection into the other.
 */
import type { CanvasPose } from "@kb/canvas";

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasPoint3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CanvasView {
  /** The focus, in canvas units. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Screen pixels per canvas unit on the focus plane. */
  readonly zoom: number;
  /** Radians. Yaw turns about the canvas's vertical axis; pitch tips its bottom toward the eye. */
  readonly yaw: number;
  readonly pitch: number;
  /** Vertical field of view in degrees; 0 is orthographic. */
  readonly fov: number;
}

export interface ViewSize {
  readonly width: number;
  readonly height: number;
}

/** A canvas point on screen: CSS pixels from the viewport's top left, and its depth. */
export interface CanvasScreenPoint {
  readonly x: number;
  readonly y: number;
  /** Distance in front of the eye along the view direction, canvas units. */
  readonly depth: number;
}

/**
 * Zoom bounds and step, owned here because every surface that changes zoom —
 * the wheel, the keymap, zoom-to-fit, an orbit's dolly — has to agree on them.
 */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;
export const ZOOM_STEP = 1.15;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * What a projection's camera does when a key or a button asks: zoom by a
 * step, zoom to a level, or frame everything. The keymap drives whichever
 * projection is showing through this, never its pan, zoom or orbit directly.
 */
export interface CanvasViewportControls {
  zoomBy(factor: number): void;
  zoomTo(zoom: number): void;
  fit(): void;
}

/** Where an orthographic eye stands behind the focus plane, canvas units (any far point will do). */
const ORTHO_STANDOFF = 1e6;

type Vec = readonly [number, number, number];

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The camera's axes in canvas space: screen right, screen down, and `back`
 * (from the focus toward the eye). Face-on they are exactly x, y and z.
 */
interface Frame {
  readonly right: Vec;
  readonly down: Vec;
  readonly back: Vec;
  /** Focal length in pixels, or null for orthographic. */
  readonly focal: number | null;
  /** The eye, canvas units. */
  readonly eye: Vec;
}

function frameOf(view: CanvasView, size: ViewSize): Frame {
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  // Tip about x by pitch, then turn about y by yaw.
  const right: Vec = [cy, 0, -sy];
  const down: Vec = [sy * -sp, cp, cy * -sp];
  const back: Vec = [sy * cp, sp, cy * cp];
  const focal = view.fov > 0 ? size.height / 2 / Math.tan((view.fov * Math.PI) / 360) : null;
  const distance = focal === null ? ORTHO_STANDOFF : focal / view.zoom;
  const eye: Vec = [
    view.x + back[0] * distance,
    view.y + back[1] * distance,
    view.z + back[2] * distance,
  ];
  return { right, down, back, focal, eye };
}

/** Where `point` lands on a viewport of `size`, or null behind the eye. */
export function projectPoint(
  view: CanvasView,
  size: ViewSize,
  point: CanvasPoint3,
): CanvasScreenPoint | null {
  const frame = frameOf(view, size);
  if (frame.focal === null) {
    const v: Vec = [point.x - view.x, point.y - view.y, point.z - view.z];
    return {
      x: size.width / 2 + dot(v, frame.right) * view.zoom,
      y: size.height / 2 + dot(v, frame.down) * view.zoom,
      depth: ORTHO_STANDOFF - dot(v, frame.back),
    };
  }
  const v: Vec = [point.x - frame.eye[0], point.y - frame.eye[1], point.z - frame.eye[2]];
  const depth = -dot(v, frame.back);
  if (!(depth > 1e-6)) return null;
  return {
    x: size.width / 2 + (dot(v, frame.right) * frame.focal) / depth,
    y: size.height / 2 + (dot(v, frame.down) * frame.focal) / depth,
    depth,
  };
}

/** The eye's ray through a screen point: where it starts and which way it runs (unit length). */
function screenRay(
  view: CanvasView,
  size: ViewSize,
  screen: CanvasPoint,
): { origin: CanvasPoint3; dir: CanvasPoint3 } {
  const frame = frameOf(view, size);
  const u = screen.x - size.width / 2;
  const v = screen.y - size.height / 2;
  const { right, down, back } = frame;
  if (frame.focal === null) {
    const across = (i: 0 | 1 | 2) =>
      (i === 0 ? view.x : i === 1 ? view.y : view.z) +
      (right[i] * u + down[i] * v) / view.zoom +
      back[i] * ORTHO_STANDOFF;
    return {
      origin: { x: across(0), y: across(1), z: across(2) },
      dir: { x: -back[0], y: -back[1], z: -back[2] },
    };
  }
  const f = frame.focal;
  const raw: Vec = [
    (right[0] * u + down[0] * v) / f - back[0],
    (right[1] * u + down[1] * v) / f - back[1],
    (right[2] * u + down[2] * v) / f - back[2],
  ];
  const length = Math.hypot(raw[0], raw[1], raw[2]);
  return {
    origin: { x: frame.eye[0], y: frame.eye[1], z: frame.eye[2] },
    dir: { x: raw[0] / length, y: raw[1] / length, z: raw[2] / length },
  };
}

/**
 * Where the ray through `screen` meets the canvas plane at depth `z`, and how
 * far along the ray that is; null when the plane is edge-on or behind the eye.
 */
function rayToPlane(
  view: CanvasView,
  size: ViewSize,
  screen: CanvasPoint,
  z: number,
): { point: CanvasPoint3; t: number } | null {
  const { origin, dir } = screenRay(view, size, screen);
  if (Math.abs(dir.z) < 1e-9) return null;
  const t = (z - origin.z) / dir.z;
  if (!(t > 0)) return null;
  return { point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z }, t };
}

/**
 * The canvas point under `screen` on the plane at depth `z`: where a click
 * places something, and where a card dragged on its own plane goes.
 */
export function screenToPlane(
  view: CanvasView,
  size: ViewSize,
  screen: CanvasPoint,
  z = 0,
): CanvasPoint3 | null {
  return rayToPlane(view, size, screen, z)?.point ?? null;
}

/** An item as the camera sees it: a rectangle on the plane at its depth. */
export interface CanvasHitItem {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Depth; absent is the canvas plane. */
  readonly z?: number;
}

/** How far apart cards at one depth stand in paint order, canvas units: a hair, but never a tie. */
const TIER_STEP = 0.08;

/**
 * Each item with the plane it is drawn on and hit at: its depth, raised a
 * hair for every earlier item at that depth, so items at one depth are
 * ordered by paint order from the front and never share a plane. `items`
 * are in paint order, back to front. Every projection draws and hit-tests
 * on these planes, so what is under a point is what is drawn there, from
 * any side.
 */
export function paintPlanes<T extends CanvasHitItem>(
  items: readonly T[],
): { readonly item: T; readonly z: number }[] {
  let tier = 0;
  return items.map((item, index) => {
    const previous = items[index - 1];
    const z = item.z ?? 0;
    tier = previous !== undefined && (previous.z ?? 0) === z ? tier + 1 : 0;
    return { item, z: z + tier * TIER_STEP };
  });
}

/**
 * The item under a screen point: of every item whose rectangle the eye's ray
 * crosses on its plane (`paintPlanes`), the nearest. `items` are in paint
 * order, back to front.
 */
export function hitTest(
  items: readonly CanvasHitItem[],
  view: CanvasView,
  size: ViewSize,
  screen: CanvasPoint,
): string | null {
  let best: { id: string; t: number } | null = null;
  for (const { item, z } of paintPlanes(items)) {
    const hit = rayToPlane(view, size, screen, z);
    if (hit === null) continue;
    const { x, y } = hit.point;
    if (x < item.x || x > item.x + item.width || y < item.y || y > item.y + item.height) continue;
    if (best === null || hit.t < best.t) best = { id: item.id, t: hit.t };
  }
  return best?.id ?? null;
}

/** The 2D view of a CSS `translate(pan) scale(zoom)` on a viewport of `size`. */
export function viewOfPan(pan: CanvasPoint, zoom: number, size: ViewSize): CanvasView {
  return {
    x: (size.width / 2 - pan.x) / zoom,
    y: (size.height / 2 - pan.y) / zoom,
    z: 0,
    zoom,
    yaw: 0,
    pitch: 0,
    fov: 0,
  };
}

/** The CSS pan and zoom that draw `view` face-on (its orbit and field of view set aside). */
export function panOfView(view: CanvasView, size: ViewSize): { pan: CanvasPoint; zoom: number } {
  return {
    pan: { x: size.width / 2 - view.x * view.zoom, y: size.height / 2 - view.y * view.zoom },
    zoom: view.zoom,
  };
}

/**
 * Client coordinates always enter through the untransformed viewport; this is
 * the 2D view's {@link screenToPlane} at the canvas plane.
 */
export function clientToCanvas(
  point: CanvasPoint,
  viewport: { left: number; top: number; width: number; height: number },
  pan: CanvasPoint,
  zoom: number,
): CanvasPoint {
  const size = { width: viewport.width, height: viewport.height };
  const local = { x: point.x - viewport.left, y: point.y - viewport.top };
  const at = screenToPlane(viewOfPan(pan, zoom, size), size, local, 0);
  return at === null ? local : { x: at.x, y: at.y };
}

/** Padding zoom-to-fit keeps around the framed items, screen pixels. */
const FIT_PAD = 40;

/**
 * `from` refocused and rezoomed to frame every item with {@link FIT_PAD} to
 * spare, never enlarging past 1:1; null when there is nothing to frame. Its
 * orbit and field of view are kept, so a fit in 3D stays in 3D.
 */
export function fitView(
  items: readonly CanvasHitItem[],
  size: ViewSize,
  from: CanvasView,
): CanvasView | null {
  if (items.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const item of items) {
    const z = item.z ?? 0;
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, item.x + item.width);
    maxY = Math.max(maxY, item.y + item.height);
    maxZ = Math.max(maxZ, z);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) return null;
  const zoom = clampZoom(
    Math.min((size.width - FIT_PAD * 2) / width, (size.height - FIT_PAD * 2) / height, 1),
  );
  return {
    ...from,
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
    zoom,
  };
}

/** An orbit never tips past this, radians: the canvas never turns edge-on or over. */
export const MAX_PITCH = 1.35;

/** Radians of orbit per pixel of drag. */
const ORBIT_PER_PIXEL = 0.004;

/**
 * Where a renderer puts its camera for `view`: the eye, the point it looks
 * at, and which way is up on screen, all in canvas space.
 */
export function cameraPose(
  view: CanvasView,
  size: ViewSize,
): { eye: CanvasPoint3; target: CanvasPoint3; up: CanvasPoint3 } {
  const { eye, down } = frameOf(view, size);
  return {
    eye: { x: eye[0], y: eye[1], z: eye[2] },
    target: { x: view.x, y: view.y, z: view.z },
    up: { x: -down[0], y: -down[1], z: -down[2] },
  };
}

/** `view` orbited by a drag of (`dx`, `dy`) pixels: across turns it, down tips it toward the eye. */
export function orbitView(view: CanvasView, dx: number, dy: number): CanvasView {
  const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, view.pitch + dy * ORBIT_PER_PIXEL));
  return { ...view, yaw: view.yaw - dx * ORBIT_PER_PIXEL, pitch };
}

/** `view` panned so the canvas follows a drag of (`dx`, `dy`) pixels on the focus plane. */
export function panView(view: CanvasView, dx: number, dy: number): CanvasView {
  const { right, down } = frameOf(view, { width: 1, height: 1 });
  const along = (i: 0 | 1 | 2) => (right[i] * dx + down[i] * dy) / view.zoom;
  return { ...view, x: view.x - along(0), y: view.y - along(1), z: view.z - along(2) };
}

/**
 * `view` zoomed by `factor` about a screen point: the canvas point under it on
 * the focus plane stays under it, as it does under a cursor.
 */
export function zoomViewAt(
  view: CanvasView,
  size: ViewSize,
  factor: number,
  screen: CanvasPoint,
): CanvasView {
  const zoom = clampZoom(view.zoom * factor);
  const keep = view.zoom / zoom;
  const { right, down } = frameOf(view, size);
  const u = (screen.x - size.width / 2) / view.zoom;
  const v = (screen.y - size.height / 2) / view.zoom;
  // The point under the cursor stays put; the focus is pulled toward it.
  const toward = (i: 0 | 1 | 2, focus: number) => {
    const under = focus + right[i] * u + down[i] * v;
    return under + (focus - under) * keep;
  };
  return { ...view, x: toward(0, view.x), y: toward(1, view.y), z: toward(2, view.z), zoom };
}

/** The shortest signed turn from angle `a` to angle `b`. */
function turn(a: number, b: number): number {
  const d = (b - a) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
}

/**
 * `t` of the way from `a` to `b`: the focus and the field of view linearly,
 * the zoom in proportion (so a dolly feels even), the orbit the short way.
 */
export function lerpView(a: CanvasView, b: CanvasView, t: number): CanvasView {
  const mix = (p: number, q: number) => p + (q - p) * t;
  return {
    x: mix(a.x, b.x),
    y: mix(a.y, b.y),
    z: mix(a.z, b.z),
    zoom: a.zoom * (b.zoom / a.zoom) ** t,
    yaw: a.yaw + turn(a.yaw, b.yaw) * t,
    pitch: mix(a.pitch, b.pitch),
    fov: mix(a.fov, b.fov),
  };
}

/** The part of a view a canvas saves: all but the field of view, which the projection owns. */
export function poseOfView(view: CanvasView): CanvasPose {
  return { x: view.x, y: view.y, z: view.z, zoom: view.zoom, yaw: view.yaw, pitch: view.pitch };
}

export function viewOfPose(pose: CanvasPose, fov: number): CanvasView {
  return { ...pose, fov };
}
