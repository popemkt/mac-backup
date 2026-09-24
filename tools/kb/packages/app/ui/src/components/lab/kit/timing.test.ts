import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TIMING_FALLBACK,
  approach,
  approachRate,
  clampStep,
  easeAt,
  parseCssSeconds,
  parseCubicBezier,
  springRate,
  springResponse,
  stepSpring,
  type Spring,
} from "./timing";

const MOTION_CSS = readFileSync(join(import.meta.dirname, "..", "..", "..", "motion.css"), "utf8");

function token(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(MOTION_CSS);
  if (match?.[1] === undefined) throw new Error(`${name} missing from motion.css`);
  return match[1];
}

describe("the timing mirror", () => {
  it("agrees with motion.css, token for token", () => {
    expect(parseCubicBezier(token("--motion-settle"))).toEqual(TIMING_FALLBACK.settle);
    const seconds = (name: string) => parseCssSeconds(token(name));
    expect(seconds("--motion-duration-quick")).toBe(TIMING_FALLBACK.quick);
    expect(seconds("--motion-duration-reveal")).toBe(TIMING_FALLBACK.reveal);
    expect(seconds("--motion-duration-theme")).toBe(TIMING_FALLBACK.theme);
    expect(seconds("--motion-duration-arrive")).toBe(TIMING_FALLBACK.arrive);
    expect(seconds("--motion-duration-follow")).toBe(TIMING_FALLBACK.follow);
    expect(seconds("--motion-stagger")).toBe(TIMING_FALLBACK.stagger);
    expect(seconds("--motion-ambient-period")).toBe(TIMING_FALLBACK.ambientPeriod);
  });

  it("keeps the principles' bounds: follow settles in 300–600ms, ambient periods are 8s+", () => {
    expect(TIMING_FALLBACK.follow).toBeGreaterThanOrEqual(0.3);
    expect(TIMING_FALLBACK.follow).toBeLessThanOrEqual(0.6);
    expect(TIMING_FALLBACK.ambientPeriod).toBeGreaterThanOrEqual(8);
  });

  it("rejects what is not a time or a curve", () => {
    expect(parseCssSeconds("fast")).toBeNull();
    expect(parseCubicBezier("ease-out")).toBeNull();
    expect(parseCubicBezier("cubic-bezier(1, 2)")).toBeNull();
  });
});

function simulate(fps: number, seconds: number): number {
  const spring: Spring = { x: 0, v: 0 };
  const rate = springRate(0.48);
  for (let i = 0; i < Math.round(seconds * fps); i++) stepSpring(spring, 1, rate, 1 / fps);
  return spring.x;
}

describe("springs and approaches", () => {
  it("settles to within 2% in the settle time, never overshooting", () => {
    expect(simulate(60, 0.48)).toBeGreaterThan(0.97);
    const spring: Spring = { x: 0, v: 0 };
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      stepSpring(spring, 1, springRate(0.48), 1 / 60);
      peak = Math.max(peak, spring.x);
    }
    expect(peak).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("is frame-rate independent (the closed form, not Euler)", () => {
    expect(simulate(30, 0.3)).toBeCloseTo(simulate(120, 0.3), 6);
    expect(springResponse(0.3, springRate(0.48))).toBeCloseTo(simulate(120, 0.3), 6);
  });

  it("approach closes 98% of the gap in its time, at any frame rate", () => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 30; i++) a = approach(a, 1, approachRate(0.5), 1 / 60);
    for (let i = 0; i < 60; i++) b = approach(b, 1, approachRate(0.5), 1 / 120);
    expect(a).toBeCloseTo(0.98, 2);
    expect(a).toBeCloseTo(b, 9);
  });

  it("clamps a long step (M2)", () => {
    expect(clampStep(3)).toBe(1 / 20);
    expect(clampStep(-1)).toBe(0);
  });

  it("solves the ease from end to end, monotonically", () => {
    const curve = TIMING_FALLBACK.settle;
    expect(easeAt(curve, 0)).toBe(0);
    expect(easeAt(curve, 1)).toBe(1);
    let previous = 0;
    for (let i = 1; i <= 20; i++) {
      const y = easeAt(curve, i / 20);
      expect(y).toBeGreaterThanOrEqual(previous);
      previous = y;
    }
  });
});
