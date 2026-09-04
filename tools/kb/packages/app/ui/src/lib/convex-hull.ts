interface Point {
  x: number;
  y: number;
}

/** > 0 when o -> a -> b turns counter-clockwise. */
function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * One side of the monotone chain over already-sorted points. Both hull halves
 * are this walk; the upper half is the same walk over the reversed order.
 */
function halfChain(pts: readonly Point[]): Point[] {
  const chain: Point[] = [];
  for (const p of pts) {
    for (;;) {
      const a = chain.at(-1);
      const o = chain.at(-2);
      if (o === undefined || a === undefined || cross(o, a, p) > 0) break;
      chain.pop();
    }
    chain.push(p);
  }
  chain.pop();
  return chain;
}

/** Monotone-chain convex hull. Returns points in CCW order. */
export function convexHull(points: Point[]): Point[] {
  if (points.length <= 1) return [...points];
  const pts = [...points].toSorted((a, b) => a.x - b.x || a.y - b.y);
  return [...halfChain(pts), ...halfChain(pts.toReversed())];
}

/** Fibonacci sphere point i of n on a sphere of given radius. */
export function fibonacciSphere(
  i: number,
  n: number,
  radius: number,
): { x: number; y: number; z: number } {
  if (n <= 1) return { x: 0, y: radius, z: 0 };
  const y = 1 - (i / (n - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = Math.PI * (3 - Math.sqrt(5)) * i;
  return {
    x: Math.cos(theta) * r * radius,
    y: y * radius,
    z: Math.sin(theta) * r * radius,
  };
}
