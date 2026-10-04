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
import { boxFrame, boxToWorld, type CanvasBox, type CanvasVec } from "./box.ts";
import { isShapeNode, type CanvasNode, type CanvasShapeKind } from "./doc.ts";

/** One step of an outline: move, line, cubic curve (two controls, then the point), close. */
export type CanvasPathCommand =
  | readonly ["M", number, number]
  | readonly ["L", number, number]
  | readonly ["C", number, number, number, number, number, number]
  | readonly ["Z"];

/** The ground plan a shape stands on, which its outline draws. */
export type CanvasFootprint = "rect" | "ellipse" | "diamond";

/**
 * What a shape fills its box with, given depth: its footprint carried
 * straight up (a box, an elliptic cylinder, a diamond prism), the ellipsoid
 * the box bounds, or a cone from the footprint up to a point over its
 * centre.
 */
export type CanvasVolume = "prism" | "ellipsoid" | "cone";

interface CanvasShapeSpec {
  readonly footprint: CanvasFootprint;
  readonly volume: CanvasVolume;
}

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

/**
 * Whether a point is on `shape`'s footprint, given in the box's unit
 * coordinates: `u` and `v` run from -1 to 1 across it, 0 at its centre. A
 * rectangle's rounded corners are a look and are not cut off here, so
 * picking and stacking treat them as square.
 */
// GAP [[01M41GAZ88QXRS7M85S0JN0ZW1]]
export function onFootprint(shape: CanvasShapeKind, u: number, v: number): boolean {
  switch (CANVAS_SHAPES[shape].footprint) {
    case "ellipse":
      return u * u + v * v <= 1;
    case "diamond":
      return Math.abs(u) + Math.abs(v) <= 1;
    case "rect":
    default:
      return Math.abs(u) <= 1 && Math.abs(v) <= 1;
  }
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
  switch (CANVAS_SHAPES[shape].footprint) {
    case "ellipse":
      return ellipse(w, h);
    case "diamond":
      return diamond(w, h);
    case "rect":
    default:
      return roundedRect(w, h, radius);
  }
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

/**
 * An item's top view: the outline of everything it fills, seen from
 * straight above, as a polygon in canvas units (x, y) — its footprint for an
 * unturned item, and for a turned one its volume's silhouette (the convex
 * hull of the volume, every footprint being convex). Round parts are
 * sampled finely; a rectangle's corners are rounded by `radius`.
 */
export function topView(
  item: CanvasBox & { readonly shape?: CanvasShapeKind },
  radius: number,
  base = item.z ?? 0,
): [number, number][] {
  const frame = boxFrame(item, base);
  const points = volumePoints(item.shape ?? "rect", frame.half, radius).map((local) => {
    const p = boxToWorld(frame, local);
    return [p.x, p.y] as const;
  });
  return hull(points);
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
