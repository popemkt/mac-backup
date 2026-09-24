import { describe, expect, it } from "vitest";
import { PopGrants } from "./pops";

function grantsOver(seconds: number, fps = 60, grants = new PopGrants()): number {
  let total = 0;
  for (let i = 0; i < seconds * fps; i++) total += grants.next(1 / fps);
  return total;
}

describe("PopGrants", () => {
  it("never grants faster than the refill, plus the one it starts with", () => {
    expect(grantsOver(10)).toBeLessThanOrEqual(1 + 0.8 * 10);
    expect(grantsOver(10)).toBeGreaterThanOrEqual(0.8 * 10 - 1);
  });

  it("keeps two grants at least the gap apart", () => {
    const grants = new PopGrants(100, 100, 0.35);
    let last = -Infinity;
    for (let f = 0; f < 600; f++) {
      if (grants.next(1 / 60) === 1) {
        expect(f / 60 - last).toBeGreaterThanOrEqual(0.35 - 1e-9);
        last = f / 60;
      }
    }
  });

  it("is frame-rate independent in the long run", () => {
    expect(Math.abs(grantsOver(20, 30) - grantsOver(20, 144))).toBeLessThanOrEqual(1);
  });
});
