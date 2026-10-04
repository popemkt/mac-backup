/**
 * Where a ray enters an item, asked from above: what a carried or placed
 * item stands on is the top view of what is under it, never its box.
 */
import { describe, expect, test } from "bun:test";
import { coversFromAbove } from "../src/index.ts";

describe("seen from above", () => {
  test("an item covers the floor points its top view does: a solid's footprint, not its box", () => {
    const ball = {
      id: "b",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      depth: 80,
      shape: "sphere" as const,
    };
    expect(coversFromAbove(ball, { x: 50, y: 50 })).toBe(true);
    expect(coversFromAbove(ball, { x: 50, y: 2 })).toBe(true);
    // The corner of its box is open floor.
    expect(coversFromAbove(ball, { x: 4, y: 4 })).toBe(false);
    const card = { id: "c", x: 0, y: 0, width: 100, height: 60, z: 30 };
    expect(coversFromAbove(card, { x: 99, y: 59 })).toBe(true);
    expect(coversFromAbove(card, { x: 101, y: 30 })).toBe(false);
  });
});
