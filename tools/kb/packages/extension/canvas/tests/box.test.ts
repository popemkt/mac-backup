/**
 * An item's box: its frame (centre and half extents), its eight corners,
 * its top, and points and directions carried between the canvas and the
 * box's own frame.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  boxCorners,
  boxFrame,
  boxToLocal,
  boxToWorld,
  boxTop,
  directionToLocal,
  directionToWorld,
  type CanvasBox,
} from "../src/index.ts";

const box: CanvasBox = { x: 10, y: 20, width: 100, height: 60, z: 5, depth: 40 };

describe("an item's box", () => {
  test("its frame stands at the box's centre, with half its extent each way", () => {
    expect(boxFrame(box)).toEqual({
      centre: { x: 60, y: 50, z: 25 },
      half: { x: 50, y: 30, z: 20 },
    });
    // A caller may raise the base (paint planes); a flat box is centred on its plane.
    expect(boxFrame(box, 9).centre.z).toBe(29);
    expect(boxFrame({ ...box, depth: undefined }).half.z).toBe(0);
  });

  test("its corners are the base clockwise from the top left, then the top", () => {
    const corners = boxCorners(box);
    expect(corners.slice(0, 4)).toEqual([
      { x: 10, y: 20, z: 5 },
      { x: 110, y: 20, z: 5 },
      { x: 110, y: 80, z: 5 },
      { x: 10, y: 80, z: 5 },
    ]);
    expect(corners.slice(4).map((c) => c.z)).toEqual([45, 45, 45, 45]);
    expect(boxTop(box)).toBe(45);
  });

  test("points and directions come back from the box's frame as they went in", () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.double({ min: -1e3, max: 1e3, noNaN: true }),
          y: fc.double({ min: -1e3, max: 1e3, noNaN: true }),
          z: fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        }),
        (p) => {
          const frame = boxFrame(box);
          const there = boxToWorld(frame, boxToLocal(frame, p));
          const turned = directionToWorld(frame, directionToLocal(frame, p));
          for (const back of [there, turned]) {
            expect(back.x).toBeCloseTo(p.x, 6);
            expect(back.y).toBeCloseTo(p.y, 6);
            expect(back.z).toBeCloseTo(p.z, 6);
          }
        },
      ),
    );
  });
});
