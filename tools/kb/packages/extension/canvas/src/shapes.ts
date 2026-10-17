/**
 * The shape table (plan 2026-10-02 decision 6). Every item is a box — its
 * footprint, its elevation `z` and its `depth` — and its shape says what
 * fills it: per shape, the footprint it stands on as the top view draws it,
 * and the volume it fills above it. Pure, so both sides of the three
 * boundary read it: every renderer traces a shape's outline from here (the
 * DOM canvas as an SVG path, the 3D canvas into its faces and meshes), the
 * camera model picks with its volume, and snapping stacks on its footprint.
 * The 3D mesh builders are keyed by the same kinds, so a shape with no mesh
 * does not type-check.
 *
 * What 2D draws and hit-tests is exactly the top view of the volume
 * ({@link topView}): a flat item is its footprint, and a solid is its volume
 * seen from above, however it is turned. The projection contract proves
 * both projections against it.
 *
 * An outline is path data in the item's own box, `w` × `h` with its origin
 * at the top left and y down, as the top view shows it: moves, lines, cubic
 * curves and a close, the subset an SVG path, a canvas 2D context and a three
 * `Shape` all speak.
 */
import {
  TOP_AXES,
  boxFrame,
  boxRotation,
  boxToWorld,
  itemFrame,
  type CanvasBox,
  type CanvasVec,
} from "./box.ts";
import {
  canvasDepth,
  canvasRotation,
  isShapeNode,
  type CanvasNode,
  type CanvasShapeKind,
} from "./doc.ts";
import { isUnrotated, type CanvasMatrix } from "./rotation.ts";

/** One step of an outline: move, line, cubic curve (two controls, then the point), close. */
export type CanvasPathCommand =
  | readonly ["M", number, number]
  | readonly ["L", number, number]
  | readonly ["C", number, number, number, number, number, number]
  | readonly ["Z"];

/**
 * What a shape fills its box with, given depth: its footprint carried
 * straight up (a box, an elliptic cylinder, a diamond prism), the ellipsoid
 * the box bounds, or a cone from the footprint up to a point over its
 * centre.
 */
export type CanvasVolume = "prism" | "ellipsoid" | "cone";

/**
 * A footprint's outline filling a `w` × `h` box, `radius` rounding what its
 * look rounds: the one statement of a ground plan, which every renderer
 * traces and every question of what it covers reads (`footprintPolygon`).
 */
type FootprintOutline = (w: number, h: number, radius: number) => CanvasPathCommand[];

interface CanvasShapeSpec {
  readonly footprint: CanvasFootprint;
  readonly volume: CanvasVolume;
}

/** The ground plans a shape stands on, each its outline. */
export const CANVAS_FOOTPRINTS = {
  rect: roundedRect,
  ellipse: (w: number, h: number) => ellipse(w, h),
  diamond: (w: number, h: number) => diamond(w, h),
} as const satisfies Readonly<Record<string, FootprintOutline>>;

/** The ground plan a shape stands on, which its outline draws. */
export type CanvasFootprint = keyof typeof CANVAS_FOOTPRINTS;

/** Every ground plan, by name. */
export const CANVAS_FOOTPRINT_KINDS: readonly CanvasFootprint[] = Object.keys(
  CANVAS_FOOTPRINTS,
).filter((kind): kind is CanvasFootprint => kind in CANVAS_FOOTPRINTS);

export const CANVAS_SHAPES: { readonly [K in CanvasShapeKind]: CanvasShapeSpec } = {
  rect: { footprint: "rect", volume: "prism" },
  ellipse: { footprint: "ellipse", volume: "prism" },
  diamond: { footprint: "diamond", volume: "prism" },
  sphere: { footprint: "ellipse", volume: "ellipsoid" },
  cone: { footprint: "ellipse", volume: "cone" },
};

/** The shape that fills an item's box: a shape item's own, a card's rectangle for any other. */
export function itemShape(item: CanvasNode): CanvasShapeKind {
  return isShapeNode(item) ? item.shape : "rect";
}

/**
 * Where on a volume its face lies, as a share of the way up its box: the
 * section of it the top view shows as its footprint, which an unturned item
 * draws its card on. A prism wears its card on its top; an ellipsoid's
 * widest section is its equator; a cone's is its base.
 */
const VOLUME_FACE: { readonly [V in CanvasVolume]: number } = {
  prism: 1,
  ellipsoid: 0.5,
  cone: 0,
};

/** How far up its box an item's face lies (0 its base, 1 its top; a flat item is all one plane). */
export function faceShare(item: CanvasNode): number {
  return VOLUME_FACE[CANVAS_SHAPES[itemShape(item)].volume];
}

/**
 * How the top view lays a turned item's face over its footprint box: the
 * face's turn about the box's centre (the one rotation matrix, as
 * `itemFrame` gives it for the top view, so a flat billboard stays
 * unturned), and its lift off that centre along the box's own up
 * (`faceShare`). Null for an unturned item, which is laid out as its box.
 * Every 2D painter places a turned face by this one rule: the DOM canvas as
 * a CSS `matrix3d`, the SVG export as the turn's top view.
 */
export interface TopFace {
  readonly matrix: CanvasMatrix;
  readonly lift: CanvasVec;
}

export function topFace(item: CanvasNode): TopFace | null {
  if (isUnrotated(canvasRotation(item))) return null;
  const m = itemFrame(item, TOP_AXES).matrix;
  const up = (faceShare(item) - 0.5) * canvasDepth(item);
  return { matrix: m, lift: { x: m[2] * up, y: m[5] * up, z: m[8] * up } };
}

/**
 * Whether a volume has a flat cap to carry a face: a prism's top. An
 * ellipsoid's or a cone's face (`VOLUME_FACE`) lies inside it, where no one
 * sees it.
 */
const VOLUME_CAPPED: { readonly [V in CanvasVolume]: boolean } = {
  prism: true,
  ellipsoid: false,
  cone: false,
};

/**
 * Whether an item's face turns to the camera in 3D rather than lying on it:
 * a billboard's (`billboard`), and a solid's whose volume has no flat cap
 * to carry it — a sphere's, a cone's. A flat item that stands is drawn
 * facing the camera whole (`facingFrame`); a solid's face stands in front
 * of its body.
 */
export function faceStands(item: CanvasBox & { readonly shape?: CanvasShapeKind }): boolean {
  if (item.billboard === true) return true;
  return (item.depth ?? 0) > 0 && !VOLUME_CAPPED[CANVAS_SHAPES[item.shape ?? "rect"].volume];
}

/** The box a footprint's polygon is flattened at: fine enough that a curve strays from it by a hair. */
const UNIT_FLATTENING = 400;

const polygons = new Map<CanvasFootprint, readonly (readonly [number, number])[]>();

/**
 * A footprint as a polygon in its box's unit coordinates: `u` and `v` run
 * from -1 to 1 across it, 0 at its centre; curves flattened finely. What
 * covers a point, where a ray crosses it and where an edge meets it are
 * all read from this one polygon, whatever the footprint. A rectangle's
 * rounded corners are a look and are not cut off here, so picking and
 * stacking treat them as square.
 */
// GAP [[01M41GAZ88QXRS7M85S0JN0ZW1]]
export function footprintPolygon(
  footprint: CanvasFootprint,
): readonly (readonly [number, number])[] {
  const known = polygons.get(footprint);
  if (known !== undefined) return known;
  const half = UNIT_FLATTENING / 2;
  const polygon = outlinePoints(
    CANVAS_FOOTPRINTS[footprint](UNIT_FLATTENING, UNIT_FLATTENING, 0),
  ).map(([x, y]) => [x / half - 1, y / half - 1] as const);
  polygons.set(footprint, polygon);
  return polygon;
}

/** How near a side a point counts as on it, in unit coordinates. */
const ON_SIDE = 1e-9;

/**
 * Whether (`u`, `v`) lies in `polygon`, its outline included: on a side,
 * or inside by the even-odd rule (a ray from it crosses its sides an odd
 * number of times).
 */
export function insidePolygon(
  polygon: readonly (readonly [number, number])[],
  u: number,
  v: number,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi = 0, yi = 0] = polygon[i] ?? [];
    const [xj = 0, yj = 0] = polygon[j] ?? [];
    const along = (u - xj) * (xi - xj) + (v - yj) * (yi - yj);
    const span = (xi - xj) ** 2 + (yi - yj) ** 2;
    const off = (u - xj) * (yi - yj) - (v - yj) * (xi - xj);
    const onSide = span > 0 && Math.abs(off) <= ON_SIDE * Math.sqrt(span);
    if (onSide && along >= 0 && along <= span) return true;
    if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a point, in the box's unit coordinates, is on `shape`'s footprint (`footprintPolygon`). */
export function onFootprint(shape: CanvasShapeKind, u: number, v: number): boolean {
  return insidePolygon(footprintPolygon(CANVAS_SHAPES[shape].footprint), u, v);
}

/** How far a cubic's control points reach to draw a quarter circle. */
const KAPPA = 0.5522847498;

function roundedRect(w: number, h: number, radius: number): CanvasPathCommand[] {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const k = r * (1 - KAPPA);
  return [
    ["M", r, 0],
    ["L", w - r, 0],
    ["C", w - k, 0, w, k, w, r],
    ["L", w, h - r],
    ["C", w, h - k, w - k, h, w - r, h],
    ["L", r, h],
    ["C", k, h, 0, h - k, 0, h - r],
    ["L", 0, r],
    ["C", 0, k, k, 0, r, 0],
    ["Z"],
  ];
}

function ellipse(w: number, h: number): CanvasPathCommand[] {
  const rx = w / 2;
  const ry = h / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    ["M", w, ry],
    ["C", w, ry + ky, rx + kx, h, rx, h],
    ["C", rx - kx, h, 0, ry + ky, 0, ry],
    ["C", 0, ry - ky, rx - kx, 0, rx, 0],
    ["C", rx + kx, 0, w, ry - ky, w, ry],
    ["Z"],
  ];
}

function diamond(w: number, h: number): CanvasPathCommand[] {
  return [["M", w / 2, 0], ["L", w, h / 2], ["L", w / 2, h], ["L", 0, h / 2], ["Z"]];
}

/**
 * The outline of a `shape` filling a `w` × `h` box, clockwise from the top
 * view. `radius` rounds a rectangle's corners (a look, which the renderer
 * reads from its tokens); the other footprints have none.
 */
export function shapeOutline(
  shape: CanvasShapeKind,
  w: number,
  h: number,
  radius: number,
): CanvasPathCommand[] {
  return CANVAS_FOOTPRINTS[CANVAS_SHAPES[shape].footprint](w, h, radius);
}

/** A coordinate to the hundredth: plenty for a path drawn in CSS pixels. */
const hundredths = (v: number) => Math.round(v * 100) / 100;

/** An outline as SVG path data. */
export function svgPathData(commands: readonly CanvasPathCommand[]): string {
  return commands
    .map(([op, ...args]) => (args.length === 0 ? op : `${op} ${args.map(hundredths).join(" ")}`))
    .join(" ");
}

/** Anything a path is traced into: a canvas 2D context, a `Path2D`, a three `Shape`. */
export interface CanvasPathSink {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): unknown;
  closePath(): unknown;
}

/** How far apart the points a curve is flattened into may be, canvas units. */
const CURVE_STEP = 6;

/** Collects an outline as points, curves flattened. */
class PointSink implements CanvasPathSink {
  readonly points: [number, number][] = [];

  moveTo(x: number, y: number): void {
    this.points.push([x, y]);
  }

  lineTo(x: number, y: number): void {
    this.points.push([x, y]);
  }

  // oxlint-disable-next-line max-params -- the canvas 2D context's own signature, which a sink speaks
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    const [x0, y0] = this.points.at(-1) ?? [x, y];
    const reach = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(
      2,
      Math.min(24, Math.ceil((reach + Math.hypot(x - x2, y - y2)) / CURVE_STEP)),
    );
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      this.points.push([
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
      ]);
    }
  }

  closePath(): void {}
}

/**
 * An outline as the points it passes through, in order, its curves
 * flattened to points no more than a few canvas units apart: what a mesh is
 * built round and what a polygon is tested against.
 */
export function outlinePoints(commands: readonly CanvasPathCommand[]): [number, number][] {
  const sink = new PointSink();
  tracePath(sink, commands);
  return sink.points;
}

/** How many points go round each ring of an ellipsoid's top-view sampling, and how many rings. */
const ROUND_SEGMENTS = 64;
const ROUND_RINGS = 16;

/** The points round an ellipse filling the box's footprint, at height `z` in its frame. */
function ellipseRing(half: CanvasVec, z: number, scale = 1): CanvasVec[] {
  return Array.from({ length: ROUND_SEGMENTS }, (_, i) => {
    const a = (i / ROUND_SEGMENTS) * Math.PI * 2;
    return { x: Math.cos(a) * half.x * scale, y: Math.sin(a) * half.y * scale, z };
  });
}

/** The points a volume's top view is the hull of, in the box's own frame. */
function volumePoints(shape: CanvasShapeKind, half: CanvasVec, radius: number): CanvasVec[] {
  const footprint = (z: number) =>
    outlinePoints(shapeOutline(shape, half.x * 2, half.y * 2, radius)).map(([x, y]) => ({
      x: x - half.x,
      y: y - half.y,
      z,
    }));
  if (half.z <= 0) return footprint(0);
  switch (CANVAS_SHAPES[shape].volume) {
    case "ellipsoid":
      return Array.from({ length: ROUND_RINGS + 1 }, (_, k) => {
        const lat = (k / ROUND_RINGS - 0.5) * Math.PI;
        return ellipseRing(half, Math.sin(lat) * half.z, Math.cos(lat));
      }).flat();
    case "cone":
      return [...footprint(-half.z), { x: 0, y: 0, z: half.z }];
    case "prism":
    default:
      return [...footprint(-half.z), ...footprint(half.z)];
  }
}

type Point2 = readonly [number, number];

/** Which way `o → a → b` turns: positive anticlockwise (in y-up terms), 0 straight on. */
const cross = (o: Point2, a: Point2, b: Point2) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** The convex hull of `points` (Andrew's monotone chain), in order round it. */
function hull(points: readonly Point2[]): [number, number][] {
  const sorted = points.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted.map(([x, y]) => [x, y]);
  const chain = (run: readonly Point2[]) => {
    const out: Point2[] = [];
    for (const p of run) {
      while (out.length >= 2 && cross(out.at(-2) ?? p, out.at(-1) ?? p, p) <= 0) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...chain(sorted), ...chain(sorted.toReversed())].map(([x, y]) => [x, y]);
}

/** A polygon in canvas units (x, y). */
type CanvasPolygon = [number, number][];

/** Twice `polygon`'s signed area: positive wound one way, negative the other. */
function windingArea(polygon: readonly (readonly [number, number])[]): number {
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi = 0, yi = 0] = polygon[i] ?? [];
    const [xj = 0, yj = 0] = polygon[j] ?? [];
    area += (xj - xi) * (yj + yi);
  }
  return area;
}

/** `polygon` wound the one way every piece of a top view is, so their union fills nonzero. */
const wound = (polygon: CanvasPolygon): CanvasPolygon =>
  windingArea(polygon) < 0 ? polygon.toReversed() : polygon;

/**
 * An item's top view: everything it fills, seen from straight above, in
 * canvas units. `pieces` are polygons, each wound the same way, whose union
 * it is (a painter fills them nonzero, and a point is in it when it is in
 * any of them); `rims` are the outlines a painter strokes round it.
 */
export interface CanvasTopView {
  readonly pieces: readonly CanvasPolygon[];
  readonly rims: readonly CanvasPolygon[];
}

/**
 * An item's top view (`CanvasTopView`). Unturned, or flat, it is its
 * footprint exactly, as its plane lies; a turned prism is its two caps and
 * every side between them, the caps its rims; a turned ellipsoid or cone,
 * both convex, is the hull of its volume. Round parts are sampled finely;
 * a rectangle's corners are rounded by `radius`.
 */
export function topView(
  item: CanvasBox & { readonly shape?: CanvasShapeKind },
  radius: number,
  base = item.z ?? 0,
): CanvasTopView {
  const frame = boxFrame(item, base);
  const { half } = frame;
  const shape = item.shape ?? "rect";
  const project = (local: CanvasVec): [number, number] => {
    const p = boxToWorld(frame, local);
    return [p.x, p.y];
  };
  const ring = (z: number) =>
    outlinePoints(shapeOutline(shape, half.x * 2, half.y * 2, radius)).map(([x, y]) =>
      project({ x: x - half.x, y: y - half.y, z }),
    );
  if (half.z <= 0 || isUnrotated(boxRotation(item))) {
    const plan = wound(ring(0));
    return { pieces: [plan], rims: [plan] };
  }
  if (CANVAS_SHAPES[shape].volume !== "prism") {
    const silhouette = wound(hull(volumePoints(shape, half, radius).map(project)));
    return { pieces: [silhouette], rims: [silhouette] };
  }
  const [bottom, top] = [ring(-half.z), ring(half.z)];
  const sides = bottom.map((at, i): CanvasPolygon => {
    const next = (i + 1) % bottom.length;
    return [at, bottom[next] ?? at, top[next] ?? at, top[i] ?? at];
  });
  const caps = [wound(bottom), wound(top)];
  return { pieces: [...caps, ...sides.map(wound)], rims: caps };
}

/** Trace `commands` into `sink`, each point mapped through `at` (identity by default). */
export function tracePath(
  sink: CanvasPathSink,
  commands: readonly CanvasPathCommand[],
  at: (x: number, y: number) => readonly [number, number] = (x, y) => [x, y],
): void {
  for (const command of commands) {
    switch (command[0]) {
      case "M":
        sink.moveTo(...at(command[1], command[2]));
        break;
      case "L":
        sink.lineTo(...at(command[1], command[2]));
        break;
      case "C": {
        const [, x1, y1, x2, y2, x, y] = command;
        sink.bezierCurveTo(...at(x1, y1), ...at(x2, y2), ...at(x, y));
        break;
      }
      case "Z":
      default:
        sink.closePath();
        break;
    }
  }
}
