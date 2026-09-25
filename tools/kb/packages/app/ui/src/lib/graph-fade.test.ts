import { describe, expect, it } from "vitest";
import { EmphasisFade } from "./graph-fade";
import { TIMING_FALLBACK } from "./timing";

const QUICK = TIMING_FALLBACK.quick;

function run(fade: EmphasisFade, seconds: number, fps = 60): void {
  for (let i = 0; i < Math.round(seconds * fps); i++) fade.step(1 / fps, false);
}

describe("EmphasisFade", () => {
  it("eases toward a new target: visible on the next frame, settled within the quick duration", () => {
    const fade = new EmphasisFade(2, QUICK);
    fade.setTarget(0, 0.2);
    fade.step(1 / 60, false);
    const first = fade.values[0] ?? 0;
    expect(first).toBeLessThan(1);
    expect(first).toBeGreaterThan(0.2);
    // 98% of the way in the quick duration…
    run(fade, QUICK);
    expect(Math.abs((fade.values[0] ?? 0) - 0.2)).toBeLessThan(0.8 * 0.021);
    // …and arrived exactly soon after.
    run(fade, QUICK);
    expect(fade.values[0]).toBeCloseTo(0.2, 6);
    expect(fade.values[1]).toBe(1);
    expect(fade.active).toBe(false);
  });

  it("never overshoots and moves monotonically", () => {
    const fade = new EmphasisFade(1, QUICK);
    fade.setTarget(0, 0);
    let previous = 1;
    for (let i = 0; i < 60; i++) {
      fade.step(1 / 60, false);
      const value = fade.values[0] ?? 0;
      expect(value).toBeLessThanOrEqual(previous);
      expect(value).toBeGreaterThanOrEqual(0);
      previous = value;
    }
  });

  it("fades back out the same way it faded in (hover in, hover out)", () => {
    const fade = new EmphasisFade(1, QUICK);
    fade.setTarget(0, 0.2);
    run(fade, 0.1);
    const mid = fade.values[0] ?? 0;
    fade.setTarget(0, 1);
    fade.step(1 / 60, false);
    expect(fade.values[0]).toBeGreaterThan(mid);
    expect(fade.values[0]).toBeLessThan(1);
  });

  it("is frame-rate independent", () => {
    const a = new EmphasisFade(1, QUICK);
    const b = new EmphasisFade(1, QUICK);
    a.setTarget(0, 0);
    b.setTarget(0, 0);
    run(a, 0.1, 30);
    run(b, 0.1, 120);
    expect(a.values[0]).toBeCloseTo(b.values[0] ?? 0, 6);
  });

  it("jumps under reduced motion (M7)", () => {
    const fade = new EmphasisFade(1, QUICK);
    fade.setTarget(0, 0.2);
    expect(fade.step(1 / 60, true)).toBe(true);
    expect(fade.values[0]).toBeCloseTo(0.2, 6);
    expect(fade.active).toBe(false);
    expect(fade.step(1 / 60, true)).toBe(false);
  });

  it("does nothing, and says so, when nothing moves", () => {
    const fade = new EmphasisFade(3, QUICK);
    expect(fade.step(1 / 60, false)).toBe(false);
    fade.setTarget(1, 1);
    expect(fade.active).toBe(false);
  });

  it("starts a new item set at its targets", () => {
    const fade = new EmphasisFade(2, QUICK);
    fade.setTarget(0, 0.2);
    fade.reset(4, 0);
    expect([...fade.values]).toEqual([0, 0, 0, 0]);
    expect(fade.active).toBe(false);
  });
});
