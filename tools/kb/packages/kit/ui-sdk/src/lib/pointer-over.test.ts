import { describe, expect, it } from "vitest";
import { placeOver } from "./pointer-over";

const BOX = { left: 100, top: 50, width: 400, height: 200 };

describe("placeOver", () => {
  it("is the pointer's place from the frame's corner", () => {
    expect(placeOver(BOX, { x: 130, y: 90 })).toEqual({ x: 30, y: 40 });
  });
  it("is none outside the frame, on every side", () => {
    for (const client of [
      { x: 99, y: 100 },
      { x: 501, y: 100 },
      { x: 200, y: 49 },
      { x: 200, y: 251 },
    ]) {
      expect(placeOver(BOX, client)).toBeNull();
    }
  });
  it("counts the frame's own edge as over it", () => {
    expect(placeOver(BOX, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 });
    expect(placeOver(BOX, { x: 500, y: 250 })).toEqual({ x: 400, y: 200 });
  });
});
