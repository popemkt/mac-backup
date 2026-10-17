import { describe, expect, it } from "vitest";
import { seededNoise, seededRng } from "./rng";

const seq = (r: ReturnType<typeof seededRng>) => Array.from({ length: 5 }, () => r.next());

describe("seededRng", () => {
  it("is reproducible from its seed and differs between seeds", () => {
    const a = seededRng(5);
    const b = seededRng(5);
    const c = seededRng(6);
    expect(seq(a)).toEqual(seq(b));
    expect(seq(seededRng(5))).not.toEqual(seq(c));
  });
  it("stays within its ranges", () => {
    const r = seededRng(1);
    for (let i = 0; i < 500; i++) {
      const v = r.range(2, 3);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThan(3);
      expect([4, 5, 6]).toContain(r.int(4, 6));
    }
  });
});

describe("seededNoise", () => {
  it("is smooth, bounded, and its own for every seed", () => {
    const n = seededNoise(11);
    let last = n(0);
    for (let t = 0.01; t < 50; t += 0.01) {
      const v = n(t);
      expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
      expect(Math.abs(v - last)).toBeLessThan(0.1);
      last = v;
    }
    expect(seededNoise(12)(3.3)).not.toBe(n(3.3));
  });
});
