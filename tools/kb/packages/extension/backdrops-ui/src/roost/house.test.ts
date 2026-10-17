import { describe, expect, it } from "vitest";
import { houseOf } from "./house";

describe("houseOf", () => {
  const sizes = [
    [1040, 380],
    [640, 300],
    [1400, 380],
  ] as const;

  it("hangs the bats from an eave inside the frame, on the stretch under the overhang", () => {
    for (const [width, height] of sizes) {
      for (const direction of ["down", "up"] as const) {
        const { eave } = houseOf(width, height, direction, true);
        expect(eave.y).toBeGreaterThan(0);
        expect(eave.y).toBeLessThan(height);
        expect(eave.from).toBeGreaterThan(0);
        expect(eave.to).toBeGreaterThan(eave.from + width * 0.2);
        expect(eave.to).toBeLessThan(width);
      }
    }
  });

  it("puts the eave high for a backdrop facing down, low for one facing up", () => {
    expect(houseOf(1040, 380, "down", true).eave.y).toBeLessThan(
      houseOf(1040, 380, "up", true).eave.y,
    );
  });

  it("lights the space under the overhang: the glow sits just below the eave, wide and low", () => {
    for (const dark of [true, false]) {
      const house = houseOf(1040, 380, "down", dark);
      expect(house.glow.y).toBeGreaterThan(house.eave.y);
      expect(house.glow.x).toBeGreaterThan(house.eave.from);
      expect(house.glow.x).toBeLessThan(house.eave.to);
      expect(house.glow.squash).toBeGreaterThan(1);
    }
  });

  it("is made of closed shapes with finite points, and a window on its wall", () => {
    const house = houseOf(1040, 380, "down", true);
    for (const poly of [...house.roof, ...house.posts, house.wall]) {
      expect(poly.length).toBeGreaterThanOrEqual(6);
      expect(poly.length % 2).toBe(0);
      expect(poly.every(Number.isFinite)).toBe(true);
    }
    expect(house.window.x).toBeLessThan(house.eave.from);
  });
});
