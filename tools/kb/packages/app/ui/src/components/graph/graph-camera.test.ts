import { describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { computeFitTarget } from "./graph-camera";

/**
 * Regression cover for the blank-canvas bug (r10 §1.1): `fitView` used to build
 * its camera target from raw post-layout graph coordinates (±10²–10³) while the
 * camera reads sigma's framed space (~[0,1]²), so fitting parked the viewport
 * hundreds of graph-widths off the data.
 */
describe("computeFitTarget", () => {
  it("centers on the framed bounding box", () => {
    const target = computeFitTarget([
      { x: 0.2, y: 0.4 },
      { x: 0.8, y: 0.6 },
    ]);
    expect(target?.x).toBeCloseTo(0.5);
    expect(target?.y).toBeCloseTo(0.5);
  });

  it("keeps the target inside framed space for a framed-space graph", () => {
    const points = Array.from({ length: 50 }, (_, i) => ({
      x: (i % 10) / 10,
      y: Math.floor(i / 10) / 10,
    }));
    const target = computeFitTarget(points);
    const fit = present(target, "fit target");
    // The old implementation returned raw centroids far outside [0,1].
    expect(fit.x).toBeGreaterThanOrEqual(0);
    expect(fit.x).toBeLessThanOrEqual(1);
    expect(fit.y).toBeGreaterThanOrEqual(0);
    expect(fit.y).toBeLessThanOrEqual(1);
  });

  it("uses the larger span with CodeFlow's 0.8 fit padding", () => {
    // Wider than tall: the x span must drive the ratio.
    const target = computeFitTarget([
      { x: 0, y: 0.45 },
      { x: 1, y: 0.55 },
    ]);
    // span 1 yields a 0.8 scale, represented as inverse Sigma ratio.
    expect(target?.ratio).toBeCloseTo(1.25);
  });

  it("caps zoom-in at 2x for a single-node lens", () => {
    const target = computeFitTarget([{ x: 0.5, y: 0.5 }]);
    const fit = present(target, "fit target");
    expect(fit.ratio).toBeCloseTo(0.5);
    expect(Number.isFinite(present(fit.ratio, "fit ratio"))).toBe(true);
  });

  it("is idempotent — fitting twice must not walk the zoom inward", () => {
    const points = [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.7 },
    ];
    const first = computeFitTarget(points);
    const second = computeFitTarget(points);
    // Derived from the live camera ratio, this drifted 0.75 -> 0.5625 -> 0.42.
    expect(second?.ratio).toBe(first?.ratio);
    expect(second?.x).toBe(first?.x);
    expect(second?.y).toBe(first?.y);
  });

  it("returns null when there is nothing to frame", () => {
    expect(computeFitTarget([])).toBeNull();
  });

  it("ignores non-finite coordinates rather than poisoning the box", () => {
    const target = computeFitTarget([
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.75 },
    ]);
    const fit = present(target, "fit target");
    expect(fit.x).toBeCloseTo(0.5);
    expect(Number.isFinite(present(fit.ratio, "fit ratio"))).toBe(true);
  });
});
