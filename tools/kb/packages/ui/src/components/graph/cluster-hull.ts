import { convexHull } from "@/lib/convex-hull";

export interface HullPoint {
  x: number;
  y: number;
}

/** How far a hull is inflated past the nodes it wraps. */
export const HULL_PAD = 24;

/** The convex hull of a cluster's viewport points, inflated by `HULL_PAD`. */
export function clusterHull(pts: readonly HullPoint[]): HullPoint[] {
  return convexHull(
    pts.flatMap((p) => [
      { x: p.x - HULL_PAD, y: p.y - HULL_PAD },
      { x: p.x + HULL_PAD, y: p.y - HULL_PAD },
      { x: p.x + HULL_PAD, y: p.y + HULL_PAD },
      { x: p.x - HULL_PAD, y: p.y + HULL_PAD },
    ]),
  );
}

/**
 * The outline kb draws for a cluster — a circle for a two-point hull, a
 * rounded polygon otherwise. Drawing and hit-testing ask this one function, so
 * the shape a user clicks is the shape they see.
 */
export function clusterHullPath(hull: readonly HullPoint[]): Path2D | undefined {
  const [a, b] = hull;
  if (a === undefined || b === undefined) return undefined;
  const path = new Path2D();
  if (hull.length === 2) {
    const r = Math.hypot(a.x - b.x, a.y - b.y) / 2 + 22;
    path.arc((a.x + b.x) / 2, (a.y + b.y) / 2, r, 0, Math.PI * 2);
    return path;
  }
  const last = hull.at(-1) ?? a;
  path.moveTo((last.x + a.x) / 2, (last.y + a.y) / 2);
  for (const [i, curr] of hull.entries()) {
    const next = hull[(i + 1) % hull.length] ?? a;
    path.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
  }
  path.closePath();
  return path;
}
