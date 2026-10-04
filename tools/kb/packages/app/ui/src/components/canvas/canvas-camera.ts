/**
 * The canvas camera: the one model of how canvas space meets the screen, which
 * every canvas projection draws, hit-tests and moves through
 * (DESIGN-UI.md → Canvas → Projections).
 *
 * Canvas space is the document's, in its units. The canvas plane is the
 * floor: x runs to the right and y down the page as the top view shows them,
 * and z points up off the floor. A view looks at a focus point from a
 * turntable orbit — `yaw` turns it about z, and `pitch` tips it from looking
 * straight down (0, the top view) to level with the floor (π/2) — through a
 * field of view, and `zoom` is how many screen pixels one canvas unit covers
 * on the plane through the focus that faces the camera. `fov` 0 is
 * orthographic.
 *
 * The 2D projection is this camera from the top and orthographic, which is
 * exactly a CSS `translate(pan) scale(zoom)`: {@link viewOfPan} and
 * {@link panOfView} are the bridge, and every 2D conversion goes through
 * them. The 3D projection is the same camera free to orbit, in perspective or
 * orthographic. Because `zoom` is measured on the focus plane, widening the
 * field of view at a fixed zoom pulls the eye in to keep that plane the same
 * size on screen — the dolly zoom that turns one projection into the other.
 */
import {
  CANVAS_SHAPES,
  TOP_AXES,
  boxFrame,
  boxToLocal,
  boxToWorld,
  boxTop,
  directionToLocal,
  faceShare,
  faceStands,
  frameCorners,
  frontFrame,
  itemFrame,
  onFootprint,
  type CanvasAxes,
  type CanvasBox,
  type CanvasFrame,
  type CanvasNode,
  type CanvasPose,
  type CanvasShapeKind,
  type CanvasVec,
} from "@kb/canvas";

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
  /** Radians. Yaw turns the orbit about z; pitch tips it from the top view (0) to level (π/2). */
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
 * step, zoom to a level, frame some items, look from a preset, or swap its
 * lens. The keymap and the view widget drive whichever projection is
 * showing through this, never its pan, zoom or orbit directly.
 */
export interface CanvasViewportControls {
  zoomBy(factor: number): void;
  zoomTo(zoom: number): void;
  /** Frame `items` ({@link fitView}); nothing to frame leaves the camera be. */
  frame(items: readonly CanvasHitItem[]): void;
  /**
   * Look at `item` face-on and frame it ({@link faceOnView}): a frame seen
   * as a viewpoint. The top-down 2D view frames one that faces up, and
   * enters 3D for any other.
   */
  faceOn(item: CanvasHitItem): void;
  /** Look from `preset`; the top-down 2D view enters 3D for any other. */
  look(preset: CanvasViewPreset): void;
  /** Swap between perspective and orthographic; from 2D, enter 3D in perspective. */
  toggleLens(): void;
}

/** What the 2D canvas's own camera answers: the rest is a way into 3D. */
export type FlatViewportControls = Omit<CanvasViewportControls, "look" | "toggleLens" | "faceOn">;

/** Where an orthographic eye stands behind the focus plane, canvas units (any far point will do). */
const ORTHO_STANDOFF = 1e6;

type Vec = readonly [number, number, number];

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The camera's axes in canvas space: screen right, screen down, and `back`
 * (from the focus toward the eye). From the top they are exactly x, y and z.
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
  // Tip toward level by pitch (screen down swings from y to -z), then turn about z by yaw.
  const right: Vec = [cy, sy, 0];
  const down: Vec = [-sy * cp, cy * cp, -sp];
  const back: Vec = [-sy * sp, cy * sp, cp];
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

/** Screen bounds, CSS pixels from the viewport's top left. */
export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** How near the eye a point may be and still project, canvas units. */
const NEAR_EYE = 1e-3;

/**
 * The screen bounds of an item's box, as `view` draws it: the part in front
 * of the eye, cut where it passes beside it; null when none of it is in
 * front.
 */
export function screenBounds(
  view: CanvasView,
  size: ViewSize,
  item: CanvasHitItem,
): ScreenRect | null {
  const frame = frameOf(view, size);
  // Each corner in the camera's own axes: across, down, and how far in front of the eye.
  const local = itemCorners(item, item.z ?? 0, viewAxes(view)).map((p): Vec => {
    const v: Vec = [p[0] - frame.eye[0], p[1] - frame.eye[1], p[2] - frame.eye[2]];
    return [dot(v, frame.right), dot(v, frame.down), -dot(v, frame.back)];
  });
  const focal = frame.focal;
  // Orthographic: every corner projects, wherever the eye stands.
  const kept = focal === null ? local : clipInFront(local);
  if (kept.length === 0) return null;
  const xs = kept.map(
    ([h, , d]) => size.width / 2 + (focal === null ? h * view.zoom : (h * focal) / d),
  );
  const ys = kept.map(
    ([, v, d]) => size.height / 2 + (focal === null ? v * view.zoom : (v * focal) / d),
  );
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

/**
 * An item's corners as a camera looking along `axes` draws it (`itemFrame`
 * in `@kb/canvas`, which stands a flat billboard square to it): its base,
 * then its top (the same four again when it is flat). {@link BOX_EDGES}
 * joins them.
 */
function itemCorners(item: CanvasHitItem, z: number, axes: CanvasAxes): Vec[] {
  return frameCorners(itemFrame(item, axes, z)).map((p): Vec => [p.x, p.y, p.z]);
}

/** Which way `view` looks, in canvas space: its screen's right and down, and back toward the eye. */
export function viewAxes(view: CanvasView): CanvasAxes {
  const { right, down, back } = frameOf(view, AXES_ONLY);
  return { right: vecOf(right), down: vecOf(down), back: vecOf(back) };
}

const vecOf = ([x, y, z]: Vec): CanvasVec => ({ x, y, z });

/** A viewport for a question about directions alone, which no viewport's size changes. */
const AXES_ONLY: ViewSize = { width: 1, height: 1 };

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

/** The twelve edges of {@link itemCorners}: the base ring, the top ring, and the four uprights. */
const BOX_EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/**
 * A box's corners in camera axes, cut to what lies at least {@link NEAR_EYE}
 * in front of the eye: the corners in front, and where each edge crosses
 * into view. Their bounds are the bounds of what is drawn.
 */
function clipInFront(corners: readonly Vec[]): Vec[] {
  const out = corners.filter((p) => p[2] >= NEAR_EYE);
  for (const [i, j] of BOX_EDGES) {
    const a = corners[i];
    const b = corners[j];
    if (a === undefined || b === undefined || a[2] >= NEAR_EYE === b[2] >= NEAR_EYE) continue;
    const t = (NEAR_EYE - a[2]) / (b[2] - a[2]);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR_EYE]);
  }
  return out;
}

/**
 * The eye's ray through a screen point: where it starts and which way it
 * runs (unit length). What every pick is asked of — the camera model's own
 * `hitTest`, and the 3D gizmo's handles.
 */
export function screenRay(
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
 * Where the ray through `screen` meets the plane at height `z`, and how
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
 * The canvas point under `screen` on the plane at height `z`: where a click
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

/**
 * An item as the camera sees it: a box standing on its footprint — the
 * rectangle `x, y, width, height` at the height of its base `z` — and rising
 * `depth` from there, filled by its shape (`CANVAS_SHAPES`). Absent, `z` is
 * the floor, `depth` 0 (flat: the shape's footprint on its plane) and the
 * shape a rectangle.
 */
export interface CanvasHitItem extends CanvasBox {
  readonly id: string;
  /** What fills the box; absent is a rectangle (every item that is not a shape). */
  readonly shape?: CanvasShapeKind;
}

/** The height of an item's top surface: what paint order and its tie-break go by. */
const topOf = (item: CanvasHitItem) => boxTop(item);

/** How far apart items with one top stand in paint order, canvas units: a hair, but never a tie. */
const TIER_STEP = 0.08;

/**
 * Each item with the base it is drawn and hit at: its own, raised a hair for
 * every earlier item whose top is at the same height, so items with one top
 * are ordered by paint order from above and never share a surface. `items`
 * are in paint order, back to front. Every projection draws and hit-tests
 * at these heights, so what is under a point is what is drawn there, from
 * any side.
 */
export function paintPlanes<T extends CanvasHitItem>(
  items: readonly T[],
): { readonly item: T; readonly z: number }[] {
  let tier = 0;
  return items.map((item, index) => {
    const previous = items[index - 1];
    tier = previous !== undefined && topOf(previous) === topOf(item) ? tier + 1 : 0;
    return { item, z: (item.z ?? 0) + tier * TIER_STEP };
  });
}

interface Ray {
  readonly origin: CanvasPoint3;
  readonly dir: CanvasPoint3;
}

/** A stretch of a ray, from where it enters a region to where it leaves. */
type Span = readonly [enter: number, exit: number];

/**
 * The stretch of a ray inside a box, or null when it misses. A flat box is
 * its rectangle: the ray crosses its plane at one point, inside or not.
 */
function boxSpan(ray: Ray, box: { readonly lo: Vec; readonly hi: Vec }): Span | null {
  const origin: Vec = [ray.origin.x, ray.origin.y, ray.origin.z];
  const dir: Vec = [ray.dir.x, ray.dir.y, ray.dir.z];
  let enter = -Infinity;
  let exit = Infinity;
  for (const i of [0, 1, 2] as const) {
    const lo = box.lo[i];
    const hi = box.hi[i];
    if (Math.abs(dir[i]) < 1e-12) {
      // Running parallel to these faces: in the slab all along, or never.
      if (origin[i] < lo || origin[i] > hi) return null;
      continue;
    }
    const near = (lo - origin[i]) / dir[i];
    const far = (hi - origin[i]) / dir[i];
    enter = Math.max(enter, Math.min(near, far));
    exit = Math.min(exit, Math.max(near, far));
    if (enter > exit) return null;
  }
  return [enter, exit];
}

/** Where `a t² + b t + c ≤ 0` along a ray: no stretch, one, or two running off to infinity. */
function quadraticSpans(a: number, b: number, c: number): Span[] {
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return c <= 0 ? [[-Infinity, Infinity]] : [];
    const t = -c / b;
    return [b > 0 ? [-Infinity, t] : [t, Infinity]];
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return a > 0 ? [] : [[-Infinity, Infinity]];
  const root = Math.sqrt(disc);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  return a > 0
    ? [[lo, hi]]
    : [
        [-Infinity, lo],
        [hi, Infinity],
      ];
}

/** The stretches in both `a` and `b`. */
function within(a: readonly Span[], b: readonly Span[]): Span[] {
  return a.flatMap(([a0, a1]) =>
    b.flatMap(([b0, b1]): Span[] => {
      const enter = Math.max(a0, b0);
      const exit = Math.min(a1, b1);
      return enter <= exit ? [[enter, exit]] : [];
    }),
  );
}

/**
 * A coordinate along the ray in the box's unit space, as `at + per · t`:
 * across the footprint -1 to 1 from its centre, up it 0 at the base and 1 at
 * the top. Linear, so a stretch of the ray is the same stretch in either.
 */
interface UnitLine {
  readonly at: number;
  readonly per: number;
}

/** A ray's coordinate (`origin + dir · t`, in the box's own frame) in its unit space, from `start` by `half`. */
const unitLine = (origin: number, dir: number, start: number, half: number): UnitLine => ({
  at: (origin - start) / half,
  per: dir / half,
});

/**
 * The stretches of a ray inside the volume a shape fills its box with
 * (`CANVAS_SHAPES`), given the box's own stretch: exactly, never by a
 * bounding box.
 */
function volumeSpans(
  shape: CanvasShapeKind,
  inBox: Span,
  [x, y, z]: readonly [UnitLine, UnitLine, UnitLine],
): Span[] {
  const { footprint, volume } = CANVAS_SHAPES[shape];
  // X² + Y² (+ k) as a quadratic in t, for the round footprints and volumes.
  const round = (extra: UnitLine, sign: number): Span[] =>
    quadraticSpans(
      x.per ** 2 + y.per ** 2 + sign * extra.per ** 2,
      2 * (x.at * x.per + y.at * y.per + sign * extra.at * extra.per),
      x.at ** 2 + y.at ** 2 + sign * extra.at ** 2 - (sign > 0 ? 1 : 0),
    );
  const none: UnitLine = { at: 0, per: 0 };
  if (volume === "ellipsoid") {
    // X² + Y² + (2Z - 1)² ≤ 1: the ellipsoid the box bounds.
    return within([inBox], round({ at: 2 * z.at - 1, per: 2 * z.per }, 1));
  }
  if (volume === "cone") {
    // X² + Y² ≤ (1 - Z)²: the footprint at the base, narrowing to a point at the top.
    return within([inBox], round({ at: 1 - z.at, per: -z.per }, -1));
  }
  if (footprint === "ellipse") return within([inBox], round(none, 1));
  if (footprint === "diamond") {
    // ±X ± Y ≤ 1: four half-spaces.
    return [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ].reduce<Span[]>(
      (spans, [sx = 1, sy = 1]) =>
        within(spans, quadraticSpans(0, sx * x.per + sy * y.per, sx * x.at + sy * y.at - 1)),
      [inBox],
    );
  }
  return [inBox];
}

/**
 * How far along a ray it first enters an item as `paintPlanes` raises it to
 * base `z`, or null when it misses or only leaves it (the eye inside). A
 * flat item is its footprint on its plane; a solid, the volume its shape
 * fills.
 */
function rayIntoItem(ray: Ray, item: CanvasHitItem, z: number, axes: CanvasAxes): number | null {
  // In the box's own frame the box is centred on the origin along its own axes.
  const frame = itemFrame(item, axes, z);
  const origin = boxToLocal(frame, ray.origin);
  const dir = directionToLocal(frame, ray.dir);
  const { half } = frame;
  const box = boxSpan(
    { origin, dir },
    { lo: [-half.x, -half.y, -half.z], hi: [half.x, half.y, half.z] },
  );
  if (box === null) return null;
  const x = unitLine(origin.x, dir.x, 0, half.x);
  const y = unitLine(origin.y, dir.y, 0, half.y);
  const shape = item.shape ?? "rect";
  if (half.z <= 0) {
    const [t] = box;
    return t > 0 && onFootprint(shape, x.at + x.per * t, y.at + y.per * t) ? t : null;
  }
  const up = unitLine(origin.z, dir.z, -half.z, half.z * 2);
  const spans = volumeSpans(shape, box, [x, y, up]).toSorted((a, b) => a[0] - b[0]);
  const ahead = spans.find(([, exit]) => exit > 0);
  return ahead !== undefined && ahead[0] > 0 ? ahead[0] : null;
}

/** How far above everything a ray looking straight down starts, canvas units. */
const ABOVE_ALL = 1e7;

/**
 * Whether `item`'s top view covers the floor point `at`: a ray looking
 * straight down through it enters the item. What snapping stands an item
 * on, and where a carry finds the top it passes over, are this answer.
 */
export function coversFromAbove(item: CanvasHitItem, at: CanvasPoint): boolean {
  const down: Ray = { origin: { x: at.x, y: at.y, z: ABOVE_ALL }, dir: { x: 0, y: 0, z: -1 } };
  return rayIntoItem(down, item, item.z ?? 0, TOP_AXES) !== null;
}

/**
 * The item under a screen point: of every item whose box the eye's ray
 * enters (`paintPlanes`), the nearest. `items` are in paint order, back to
 * front.
 */
export function hitTest(
  items: readonly CanvasHitItem[],
  view: CanvasView,
  size: ViewSize,
  screen: CanvasPoint,
): string | null {
  const ray = screenRay(view, size, screen);
  const axes = viewAxes(view);
  let best: { id: string; t: number } | null = null;
  for (const { item, z } of paintPlanes(items)) {
    const t = rayIntoItem(ray, item, z, axes);
    if (t !== null && (best === null || t < best.t)) best = { id: item.id, t };
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

/** The CSS pan and zoom that draw `view` from the top (its orbit and field of view set aside). */
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

/** Padding a frame keeps around the framed items, screen pixels. */
const FIT_PAD = 40;

/**
 * `from` refocused and rezoomed to frame `items` with {@link FIT_PAD} to
 * spare, never enlarging past 1:1; null when there is nothing to frame. Its
 * orbit and field of view are kept, so a frame in 3D stays in 3D, and the
 * items' extent is measured across the screen as that orbit sees it: from the
 * top their footprint, from the front their width and height above the floor.
 */
export function fitView(
  items: readonly CanvasHitItem[],
  size: ViewSize,
  from: CanvasView,
): CanvasView | null {
  if (items.length === 0) return null;
  const { right, down } = frameOf(from, size);
  const axes = viewAxes(from);
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  const across = { min: Infinity, max: -Infinity };
  const upDown = { min: Infinity, max: -Infinity };
  for (const item of items) {
    for (const corner of itemCorners(item, item.z ?? 0, axes)) {
      corner.forEach((v, i) => {
        low[i] = Math.min(low[i] ?? v, v);
        high[i] = Math.max(high[i] ?? v, v);
      });
      const h = dot(corner, right);
      const v = dot(corner, down);
      across.min = Math.min(across.min, h);
      across.max = Math.max(across.max, h);
      upDown.min = Math.min(upDown.min, v);
      upDown.max = Math.max(upDown.max, v);
    }
  }
  const fits = [
    { extent: across.max - across.min, room: size.width - FIT_PAD * 2 },
    { extent: upDown.max - upDown.min, room: size.height - FIT_PAD * 2 },
  ].filter(({ extent }) => extent > 1e-6);
  if (fits.length === 0) return null;
  const zoom = clampZoom(Math.min(1, ...fits.map(({ extent, room }) => room / extent)));
  const mid = (i: 0 | 1 | 2) => ((low[i] ?? 0) + (high[i] ?? 0)) / 2;
  return { ...from, x: mid(0), y: mid(1), z: mid(2), zoom };
}

/** Under this much pitch, radians, a view is from the top, and its yaw only turns the screen. */
const FROM_TOP = 1e-3;

/**
 * `from` turned to look at `item` face-on and refocused to frame it (its
 * lens kept): the eye stands on the side its face points to — its box's
 * own Z, turned (from above, for a face turned down: there is no view from
 * under the floor) — and a face seen from the top is squared to the screen
 * along its own X. A frame on the floor is looked at from the top; one
 * stood up as a wall, level from in front of it. A face that stands
 * (`faceStands`: a billboard's, a sphere's) faces every view, so the orbit
 * is kept and the item only framed. Null when there is nothing to frame.
 */
export function faceOnView(
  item: CanvasHitItem,
  size: ViewSize,
  from: CanvasView,
): CanvasView | null {
  if (faceStands(item)) return fitView([item], size, from);
  const m = boxFrame(item).matrix;
  const up = m[8] < 0 ? -1 : 1;
  const normal = { x: m[2] * up, y: m[5] * up, z: m[8] * up };
  const pitch = Math.acos(Math.min(1, normal.z));
  const yaw = pitch < FROM_TOP ? Math.atan2(m[3], m[0]) : Math.atan2(-normal.x, normal.y);
  return fitView([item], size, { ...from, yaw, pitch: clampPitch(pitch) });
}

/** Whether `view` looks straight down with the screen along x and y: what the 2D view can show. */
export function isTopView(view: CanvasView): boolean {
  return view.pitch < FROM_TOP && Math.abs(turn(view.yaw, 0)) < FROM_TOP;
}

/** An orbit tips no further than level with the floor, radians, and never under it. */
export const MAX_PITCH = Math.PI / 2;

/** Radians of orbit per pixel of drag. */
const ORBIT_PER_PIXEL = 0.004;

const clampPitch = (pitch: number) => Math.max(0, Math.min(MAX_PITCH, pitch));

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

/**
 * `view` orbited by a drag of (`dx`, `dy`) pixels, as a turntable: across
 * turns the floor about z with the hand (its near edge follows the drag), and
 * down tips the view toward the top, up toward level with the floor.
 */
export function orbitView(view: CanvasView, dx: number, dy: number): CanvasView {
  const pitch = clampPitch(view.pitch - dy * ORBIT_PER_PIXEL);
  return { ...view, yaw: view.yaw + dx * ORBIT_PER_PIXEL, pitch };
}

/** The view the orbit holds once it is let go: pitch within the floor's range. */
export function heldOrbit(view: CanvasView): CanvasView {
  return { ...view, pitch: clampPitch(view.pitch) };
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

/** The part of a view a canvas saves and reports: all of it, in the document's pose shape. */
export function poseOfView(view: CanvasView): CanvasPose {
  const { x, y, z, zoom, yaw, pitch, fov } = view;
  return { x, y, z, zoom, yaw, pitch, fov };
}

/** The view a saved pose stands for; a pose saved before poses had a lens is seen through `fov`. */
export function viewOfPose(pose: CanvasPose, fov: number): CanvasView {
  return { ...pose, fov: pose.fov ?? fov };
}

// ── lenses ───────────────────────────────────────────────────────────────

/** How the camera draws depth: converging (perspective) or not at all (orthographic). */
export type CanvasLens = "perspective" | "orthographic";

/** The perspective lens's vertical field of view, degrees: long, so cards stay square-on readable. */
export const PERSPECTIVE_FOV = 34;

export function lensOf(view: CanvasView): CanvasLens {
  return view.fov > 0 ? "perspective" : "orthographic";
}

/** `view` through `lens`, at the same zoom on its focus plane (a dolly zoom when flown). */
export function withLens(view: CanvasView, lens: CanvasLens): CanvasView {
  return { ...view, fov: lens === "perspective" ? PERSPECTIVE_FOV : 0 };
}

// ── view presets ─────────────────────────────────────────────────────────

/**
 * The named orientations of the orbit, Blender's numpad views: from the top
 * (the 2D view's), level from each side, and the oblique look a canvas first
 * opens at in 3D. Each side is named for where the eye stands — `front` on
 * the +y side, looking across the floor with x to the right; `right` on +x.
 */
const CANVAS_VIEW_PRESET_KINDS = ["top", "front", "right", "back", "left", "oblique"] as const;
export type CanvasViewPreset = (typeof CANVAS_VIEW_PRESET_KINDS)[number];

interface ViewPresetSpec {
  readonly label: string;
  readonly yaw: number;
  readonly pitch: number;
}

export const CANVAS_VIEW_PRESETS: { readonly [P in CanvasViewPreset]: ViewPresetSpec } = {
  top: { label: "Top", yaw: 0, pitch: 0 },
  front: { label: "Front", yaw: 0, pitch: MAX_PITCH },
  right: { label: "Right", yaw: -Math.PI / 2, pitch: MAX_PITCH },
  back: { label: "Back", yaw: Math.PI, pitch: MAX_PITCH },
  left: { label: "Left", yaw: Math.PI / 2, pitch: MAX_PITCH },
  oblique: { label: "Oblique", yaw: -0.4, pitch: 0.85 },
};

/** `from` turned to look from `preset`, its focus, zoom and lens kept. */
export function presetView(from: CanvasView, preset: CanvasViewPreset): CanvasView {
  const { yaw, pitch } = CANVAS_VIEW_PRESETS[preset];
  return { ...from, yaw, pitch };
}

/** The preset `view` looks from, if it is one (to a hair); null for any other orbit. */
export function presetOf(view: CanvasView): CanvasViewPreset | null {
  const near = (preset: CanvasViewPreset) => {
    const spec = CANVAS_VIEW_PRESETS[preset];
    return Math.abs(turn(view.yaw, spec.yaw)) < 1e-3 && Math.abs(view.pitch - spec.pitch) < 1e-3;
  };
  return CANVAS_VIEW_PRESET_KINDS.find(near) ?? null;
}

/** One canvas axis as the camera sees it: its screen direction, and how far it points at the eye. */
export interface ScreenAxis {
  readonly x: number;
  readonly y: number;
  /** -1 (straight away from the eye) to 1 (straight at it). */
  readonly toward: number;
}

/** The three canvas axes as `view` sees them: what an axis widget draws. */
export function screenAxes(view: CanvasView): { readonly [A in "x" | "y" | "z"]: ScreenAxis } {
  const { right, down, back } = frameOf(view, { width: 1, height: 1 });
  const axis = (i: 0 | 1 | 2): ScreenAxis => ({ x: right[i], y: down[i], toward: back[i] });
  return { x: axis(0), y: axis(1), z: axis(2) };
}
