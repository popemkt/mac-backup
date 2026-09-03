/** Monotone-chain convex hull. Returns points in CCW order. */
export function convexHull(
  points: Array<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  if (points.length <= 1) return [...points];
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Array<{ x: number; y: number }> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Array<{ x: number; y: number }> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
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
