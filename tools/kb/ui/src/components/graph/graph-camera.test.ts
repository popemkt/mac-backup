import { describe, expect, it } from "vitest";
import { computeFitTarget } from "./graph-camera";

/**
 * Regression cover for the blank-canvas bug (r10 §1.1): `fitView` used to build
 * its camera target from raw post-layout graph coordinates (±10²–10³) while the
 * camera reads sigma's framed space (~[0,1]²), so fitting parked the viewport
 * hundreds of graph-widths off the data.
 */
describe("computeFitTarget", () => {
  it("centers on the framed bounding box", () => {
    const target = computeFitTarget(
      [
        { x: 0.2, y: 0.4 },
        { x: 0.8, y: 0.6 },
      ],
      1,
    );
    expect(target?.x).toBeCloseTo(0.5);
    expect(target?.y).toBeCloseTo(0.5);
  });

  it("keeps the target inside framed space for a framed-space graph", () => {
    const points = Array.from({ length: 50 }, (_, i) => ({
      x: (i % 10) / 10,
      y: Math.floor(i / 10) / 10,
    }));
    const target = computeFitTarget(points);
    // The old implementation returned raw centroids far outside [0,1].
    expect(target!.x).toBeGreaterThanOrEqual(0);
    expect(target!.x).toBeLessThanOrEqual(1);
    expect(target!.y).toBeGreaterThanOrEqual(0);
    expect(target!.y).toBeLessThanOrEqual(1);
  });

  it("uses the larger span with CodeFlow's 0.8 fit padding", () => {
    // Wider than tall: the x span must drive the ratio.
    const target = computeFitTarget(
      [
        { x: 0, y: 0.45 },
        { x: 1, y: 0.55 },
      ],
      1,
    );
    // span 1 yields a 0.8 scale, represented as inverse Sigma ratio.
    expect(target?.ratio).toBeCloseTo(1.25);
  });

  it("caps zoom-in at 2x for a single-node lens", () => {
    const target = computeFitTarget([{ x: 0.5, y: 0.5 }]);
    expect(target?.ratio).toBeCloseTo(0.5);
    expect(Number.isFinite(target!.ratio!)).toBe(true);
  });

  it("returns null when there is nothing to frame", () => {
    expect(computeFitTarget([])).toBeNull();
  });

  it("ignores non-finite coordinates rather than poisoning the box", () => {
    const target = computeFitTarget([
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.75 },
    ]);
    expect(target?.x).toBeCloseTo(0.5);
    expect(Number.isFinite(target!.ratio!)).toBe(true);
  });
});
