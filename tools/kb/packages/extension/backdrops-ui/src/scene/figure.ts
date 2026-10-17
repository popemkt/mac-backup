/**
 * Figures: the shapes the scenes cast. A figure is flat polygons in the
 * actor's own units (x forward, y down, one body length across), built from a
 * pose and never from a sprite, so a wing is a real wing at every point of
 * its beat. Rendering decides what the polygons are filled with
 * (`draw-figure.ts`); nothing here knows a colour.
 */

/** A flat run of x, y pairs. */
export type Poly = number[];

interface Eye {
  readonly x: number;
  readonly y: number;
  /** Radius, in body lengths. */
  readonly r: number;
  /** 1 for the eye nearest the viewer, less for the far one. */
  readonly weight: number;
}

export interface Figure {
  /** Wing skin: closed, filled a little translucent so the bones read through. */
  readonly membranes: Poly[];
  /** Body, head, ears, tail: closed and opaque. */
  readonly solids: Poly[];
  /** Wing bones and leading edges: open lines, stroked opaque. */
  readonly struts: Poly[];
  readonly eyes: Eye[];
}

/** Twice the signed area: the sign is the winding. */
function area2(poly: Poly): number {
  let total = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    total +=
      (poly[i * 2] ?? 0) * (poly[j * 2 + 1] ?? 0) - (poly[j * 2] ?? 0) * (poly[i * 2 + 1] ?? 0);
  }
  return total;
}

/**
 * `poly` wound one fixed way. Many closed shapes drawn into one path
 * overlap as a union only if they all wind alike; opposite windings would
 * cancel where they cross.
 */
export function wound(poly: Poly): Poly {
  if (area2(poly) >= 0) return poly;
  const out: Poly = [];
  for (let i = poly.length / 2 - 1; i >= 0; i--) out.push(poly[i * 2] ?? 0, poly[i * 2 + 1] ?? 0);
  return out;
}

export interface EllipseShape {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly rotation?: number;
}

/** An ellipse as a polygon of `n` points. */
export function ellipse({ cx, cy, rx, ry, rotation = 0 }: EllipseShape, n = 14): Poly {
  const out: Poly = [];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    out.push(cx + x * cos - y * sin, cy + x * sin + y * cos);
  }
  return out;
}

/** Points along a quadratic curve, `from` excluded and `to` included. */
export function quadTo(
  out: Poly,
  from: readonly [number, number],
  control: readonly [number, number],
  to: readonly [number, number],
  steps: number,
): void {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const k = 1 - t;
    out.push(
      k * k * from[0] + 2 * k * t * control[0] + t * t * to[0],
      k * k * from[1] + 2 * k * t * control[1] + t * t * to[1],
    );
  }
}
