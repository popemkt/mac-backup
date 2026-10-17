import { describe, expect, it } from "vitest";
import { angleDelta, clamp, damp, dampAngle, envelope, smoothstep, wrapAngle } from "./math";

describe("damp", () => {
  it("lands in the same place however the time is cut up", () => {
    let coarse = 0;
    let fine = 0;
    for (let i = 0; i < 30; i++) coarse = damp(coarse, 1, 3, 1 / 30);
    for (let i = 0; i < 120; i++) fine = damp(fine, 1, 3, 1 / 120);
    expect(coarse).toBeCloseTo(fine, 6);
  });
  it("never overshoots", () => {
    let value = 0;
    for (let i = 0; i < 50; i++) {
      value = damp(value, 1, 40, 0.05);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("angles", () => {
  it("wraps into (-π, π]", () => {
    for (const a of [-7, -3.2, 0, 3.2, 7, 100]) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThan(-Math.PI - 1e-9);
      expect(w).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });
  it("turns the short way round", () => {
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6, 6);
    expect(dampAngle(3, -3, 100, 1)).toBeCloseTo(-3, 3);
  });
});

describe("curves", () => {
  it("smoothstep is 0 and 1 outside, and monotone inside", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.7)).toBeGreaterThan(smoothstep(0, 1, 0.3));
  });
  it("an envelope rises to 1 and falls away", () => {
    expect(envelope(-1, 0.2, 1)).toBe(0);
    expect(envelope(0.2, 0.2, 1)).toBeCloseTo(1, 6);
    expect(envelope(3, 0.2, 1)).toBeLessThan(envelope(1, 0.2, 1));
    expect(clamp(envelope(0.1, 0.2, 1), 0, 1)).toBeGreaterThan(0);
  });
});
