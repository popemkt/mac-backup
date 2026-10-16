import { describe, expect, it } from "vitest";
import { convexHull, fibonacciSphere } from "./convex-hull";

describe("convexHull", () => {
  it("returns the outer square for interior points", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 1, y: 1 },
    ]);
    expect(hull).toHaveLength(4);
  });
});

describe("fibonacciSphere", () => {
  it("places points on a sphere of given radius", () => {
    const n = 8;
    const r = 100;
    for (let i = 0; i < n; i++) {
      const p = fibonacciSphere(i, n, r);
      const dist = Math.hypot(p.x, p.y, p.z);
      expect(dist).toBeCloseTo(r, 5);
    }
  });
});
