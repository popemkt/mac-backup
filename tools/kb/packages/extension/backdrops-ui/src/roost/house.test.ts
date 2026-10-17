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
        expect(eave.from).toBeGreaterThan(width * 0.2);
        expect(eave.to).toBeGreaterThan(eave.from + width * 0.2);
        expect(eave.to).toBeLessThan(width * 0.75);
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

  it("keeps the window, the one warm thing, on the wall away from the reading column", () => {
    for (const [width, height] of sizes) {
      const { window } = houseOf(width, height, "down", true);
      expect(window.x).toBeGreaterThan(width * 0.7);
    }
  });

  it("is made of closed shapes with finite points, each fade running away from the page's tone", () => {
    const house = houseOf(1040, 380, "down", true);
    for (const poly of [
      house.roof.poly,
      house.wall.poly,
      house.post.poly,
      house.brace,
      ...house.crisp,
    ]) {
      expect(poly.length).toBeGreaterThanOrEqual(6);
      expect(poly.length % 2).toBe(0);
      expect(poly.every(Number.isFinite)).toBe(true);
    }
    expect(house.roof.to.y).toBeLessThan(house.roof.from.y);
    expect(house.post.to.y).toBeGreaterThan(house.post.from.y);
  });
});
