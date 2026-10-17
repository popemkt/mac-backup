/**
 * Painting a figure (`figure.ts`) with the silhouette trick: the body is the
 * page's own background tone, so what shows of an actor is only where light
 * is behind it. A thin rim, the light caught on the edge facing the glow, is
 * the same shape laid a hair toward the light under the body.
 */
import type { Figure, Poly } from "./figure.ts";

export interface Placement {
  /** Screen position, CSS pixels. */
  readonly x: number;
  readonly y: number;
  /** One body length, CSS pixels. */
  readonly size: number;
  /** Nose-up positive when facing right, radians. */
  readonly tilt: number;
  /** +1 faces right, -1 left. */
  readonly mirror: 1 | -1;
  /** Horizontal squash for a turn: 1 side-on, down to ~0.25 head-on. */
  readonly squash: number;
}

export interface Ink {
  /** The body tone, as a CSS colour. */
  readonly body: string;
  /** The wing skin is a little translucent so its bones read through: 0..1. */
  readonly membrane: number;
  /** Everything's overall opacity: a far actor is veiled. */
  readonly alpha: number;
  /** The rim: colour, strength 0..1, and the screen-space offset toward the light. */
  readonly rim: {
    readonly color: string;
    readonly strength: number;
    readonly dx: number;
    readonly dy: number;
  };
}

function tracePath(ctx: CanvasRenderingContext2D, polys: readonly Poly[]): void {
  for (const poly of polys) {
    const n = poly.length;
    if (n < 4) continue;
    ctx.moveTo(poly[0] ?? 0, poly[1] ?? 0);
    for (let i = 2; i < n; i += 2) ctx.lineTo(poly[i] ?? 0, poly[i + 1] ?? 0);
    ctx.closePath();
  }
}

function strokePath(ctx: CanvasRenderingContext2D, polys: readonly Poly[]): void {
  for (const poly of polys) {
    const n = poly.length;
    if (n < 4) continue;
    ctx.moveTo(poly[0] ?? 0, poly[1] ?? 0);
    for (let i = 2; i < n; i += 2) ctx.lineTo(poly[i] ?? 0, poly[i + 1] ?? 0);
  }
}

/** Set the transform that maps figure units to the canvas, `dpr` device pixels per CSS pixel. */
function place(ctx: CanvasRenderingContext2D, at: Placement, dpr: number, dx: number, dy: number) {
  const turn = -at.tilt * at.mirror;
  const cos = Math.cos(turn) * at.size;
  const sin = Math.sin(turn) * at.size;
  const sx = at.mirror * at.squash;
  ctx.setTransform(
    dpr * cos * sx,
    dpr * sin * sx,
    -dpr * sin,
    dpr * cos,
    dpr * (at.x + dx),
    dpr * (at.y + dy),
  );
}

export function drawFigure(
  ctx: CanvasRenderingContext2D,
  figure: Figure,
  at: Placement,
  ink: Ink,
  dpr: number,
): void {
  if (ink.rim.strength > 0.01) {
    place(ctx, at, dpr, ink.rim.dx, ink.rim.dy);
    ctx.globalAlpha = ink.rim.strength * ink.alpha;
    ctx.fillStyle = ink.rim.color;
    ctx.beginPath();
    tracePath(ctx, figure.membranes);
    tracePath(ctx, figure.solids);
    ctx.fill();
  }
  place(ctx, at, dpr, 0, 0);
  ctx.fillStyle = ink.body;
  ctx.globalAlpha = ink.alpha * ink.membrane;
  ctx.beginPath();
  tracePath(ctx, figure.membranes);
  ctx.fill();
  ctx.globalAlpha = ink.alpha;
  ctx.beginPath();
  tracePath(ctx, figure.solids);
  ctx.fill();
  ctx.strokeStyle = ink.body;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(0.05, 1.4 / at.size);
  ctx.beginPath();
  strokePath(ctx, figure.struts);
  ctx.stroke();
}

/** Where figure-unit point (x, y) lands on the screen for `at`, CSS pixels. */
export function toScreen(at: Placement, x: number, y: number): { x: number; y: number } {
  const turn = -at.tilt * at.mirror;
  const cos = Math.cos(turn) * at.size;
  const sin = Math.sin(turn) * at.size;
  const lx = x * at.mirror * at.squash;
  return { x: at.x + cos * lx - sin * y, y: at.y + sin * lx + cos * y };
}
