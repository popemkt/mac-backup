/**
 * The shape table (plan 2026-10-02 decision 6): what each shape stands on, as
 * the top view draws it. Every renderer traces a shape's outline from here —
 * the DOM canvas as an SVG path, the 3D canvas into its face textures — so
 * the 2D and the 3D picture of one item cannot disagree about its outline.
 *
 * An outline is path data in the item's own box, `w` × `h` with its origin
 * at the top left and y down, as the top view shows it: moves, lines, cubic
 * curves and a close, the subset an SVG path, a canvas 2D context and a three
 * `Shape` all speak.
 */
import type { CanvasShapeKind } from "./doc.ts";

/** One step of an outline: move, line, cubic curve (two controls, then the point), close. */
export type CanvasPathCommand =
  | readonly ["M", number, number]
  | readonly ["L", number, number]
  | readonly ["C", number, number, number, number, number, number]
  | readonly ["Z"];

/** The ground plan an outline is drawn from. */
type CanvasFootprint = "rect" | "ellipse" | "diamond";

interface CanvasShapeSpec {
  /** What it stands on, as the top view draws it. */
  readonly footprint: CanvasFootprint;
}

const CANVAS_SHAPES: { readonly [K in CanvasShapeKind]: CanvasShapeSpec } = {
  rect: { footprint: "rect" },
  ellipse: { footprint: "ellipse" },
  diamond: { footprint: "diamond" },
};

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
