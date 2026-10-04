/**
 * An item's box: its frame (centre, half extents and turn), its eight corners,
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
  TOP_AXES,
  faceStands,
  facesCamera,
  facingFrame,
  frameCorners,
  frontFrame,
  itemFrame,
  parseCanvasDoc,
  stringifyCanvasDoc,
  withBillboard,
  type CanvasAxes,
  type CanvasBox,
  type CanvasNode,
} from "../src/index.ts";

const box: CanvasBox = { x: 10, y: 20, width: 100, height: 60, z: 5, depth: 40 };

describe("an item's box", () => {
  test("its frame stands at the box's centre, with half its extent each way", () => {
    expect(boxFrame(box)).toEqual({
      centre: { x: 60, y: 50, z: 25 },
      half: { x: 50, y: 30, z: 20 },
      // Unturned, its own axes are the canvas's.
      matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
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
          for (const one of [box, { ...box, rotation: { x: 20, y: -35, z: 70 } }]) {
            const frame = boxFrame(one);
            const there = boxToWorld(frame, boxToLocal(frame, p));
            const turned = directionToWorld(frame, directionToLocal(frame, p));
            for (const back of [there, turned]) {
              expect(back.x).toBeCloseTo(p.x, 6);
              expect(back.y).toBeCloseTo(p.y, 6);
              expect(back.z).toBeCloseTo(p.z, 6);
            }
          }
        },
      ),
    );
  });
});

/** A camera level with the floor, looking from the front (+y) toward -y: x right, z up. */
const LEVEL_FROM_FRONT: CanvasAxes = {
  right: { x: 1, y: 0, z: 0 },
  down: { x: 0, y: 0, z: -1 },
  back: { x: 0, y: 1, z: 0 },
};

const close = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
  expect(a.z).toBeCloseTo(b.z, 9);
};

const shape = (kind: "rect" | "sphere" | "cone", depth: number): CanvasNode => ({
  id: kind,
  type: "shape",
  shape: kind,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  depth,
});

/** A document of one text item whose `billboard` is written as given. */
const raw = (billboard: unknown) => ({
  nodes: [{ id: "a", type: "text", text: "", x: 0, y: 0, width: 1, height: 1, billboard }],
  edges: [],
});

describe("billboards", () => {
  const label: CanvasBox = {
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    z: 10,
    billboard: true,
    rotation: { z: 30 },
  };

  test("from the top a flat billboard is its footprint, unturned", () => {
    const corners = frameCorners(itemFrame(label, TOP_AXES)).slice(0, 4);
    [
      { x: 0, y: 0, z: 10 },
      { x: 100, y: 0, z: 10 },
      { x: 100, y: 40, z: 10 },
      { x: 0, y: 40, z: 10 },
    ].forEach((corner, i) => close(corners[i] ?? corner, corner));
  });

  test("level with the floor it stands up from where it lies, square to the camera", () => {
    const corners = frameCorners(facingFrame(label, LEVEL_FROM_FRONT)).slice(0, 4);
    // Top left, top right, bottom right, bottom left: its lower edge on its plane.
    [
      { x: 0, y: 20, z: 50 },
      { x: 100, y: 20, z: 50 },
      { x: 100, y: 20, z: 10 },
      { x: 0, y: 20, z: 10 },
    ].forEach((corner, i) => close(corners[i] ?? corner, corner));
  });

  test("only a flat billboard faces the camera whole; a solid one keeps its body's turn", () => {
    expect(facesCamera(label)).toBe(true);
    const solid = { ...label, depth: 30 };
    expect(facesCamera(solid)).toBe(false);
    expect(itemFrame(solid, LEVEL_FROM_FRONT)).toEqual(boxFrame(solid));
  });

  test("a standing face stands in front of the whole box, square to the camera", () => {
    const tilted: CanvasBox = { ...box, rotation: { x: 30, y: 20, z: 50 } };
    const front = frontFrame(tilted, LEVEL_FROM_FRONT);
    const plane = front.centre.y;
    for (const corner of boxCorners(tilted)) expect(corner.y).toBeLessThan(plane);
    // Toward the eye from the box's centre, and as wide and tall as its footprint.
    close({ ...front.centre, y: 0 }, { ...boxFrame(tilted).centre, y: 0 });
    expect(front.half).toEqual({ x: 50, y: 30, z: 0 });
  });

  test("a face stands for a billboard, and for a solid with no flat top to carry it", () => {
    expect(faceStands(shape("rect", 10))).toBe(false);
    expect(faceStands(shape("sphere", 10))).toBe(true);
    expect(faceStands(shape("cone", 10))).toBe(true);
    // Flat, a sphere is its footprint, which carries its face.
    expect(faceStands(shape("sphere", 0))).toBe(false);
    expect(faceStands(withBillboard(shape("rect", 10), true))).toBe(true);
  });

  test("billboard is written only when set, and a value kb cannot read round-trips", () => {
    const [on] = parseCanvasDoc(raw(true)).nodes;
    expect(on?.billboard).toBe(true);
    const off = on === undefined ? undefined : withBillboard(on, false);
    expect(off).not.toHaveProperty("billboard");
    const odd = parseCanvasDoc(raw("yes"));
    expect(JSON.parse(stringifyCanvasDoc(odd)).nodes[0].billboard).toBe("yes");
    const [read] = odd.nodes;
    expect(read === undefined ? undefined : withBillboard(read, true).extra).toBeUndefined();
  });
});
