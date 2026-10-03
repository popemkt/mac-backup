import { describe, expect, it } from "vitest";
import {
  IDENTITY,
  stillAbout,
  turnAbout,
  type CanvasNode,
  type CanvasTransform,
  type CanvasVec,
} from "@kb/canvas";
import { snapCanvasMove, snapPrecise, snapToSurface } from "./canvas-snap";

const node = (id: string, x: number): CanvasNode => ({
  id,
  type: "text",
  text: "",
  x,
  y: 0,
  width: 100,
  height: 60,
});
it("uses the closest alignment once per axis, independent of candidate order", () => {
  const others = [node("b", 203), node("c", 201)];
  expect(snapCanvasMove(node("a", 0), others, 100, 0, 1).dx).toBe(101);
  expect(snapCanvasMove(node("a", 0), others.toReversed(), 100, 0, 1).dx).toBe(101);
});
it("names the alignment it snapped to on each axis it snapped", () => {
  const moved = snapCanvasMove(node("a", 0), [node("b", 203)], 100, 0, 1);
  expect(moved.guides).toEqual([
    { axis: "x", pos: 203 },
    { axis: "y", pos: 0 },
  ]);
});
/** A transform about the origin that only moves, along the canvas's axes or `axes`. */
const moveBy = (move: CanvasVec, axes = IDENTITY): CanvasTransform => ({
  ...stillAbout({ x: 0, y: 0, z: 0 }),
  axes,
  move,
});

it("lifts to the heights other items stand at, within the same tolerance", () => {
  const raised = { ...node("b", 400), z: 120 };
  expect(snapPrecise(moveBy({ x: 0, y: 0, z: 117 }), [node("a", 0)], [raised], 1)).toEqual({
    transform: moveBy({ x: 0, y: 0, z: 120 }),
    guides: [{ axis: "z", pos: 120 }],
  });
});
it("keeps snapping tolerance consistent in screen pixels", () => {
  expect(snapCanvasMove(node("a", 0), [node("b", 208)], 100, 0, 0.5).dx).toBe(108);
  expect(snapCanvasMove(node("a", 0), [node("b", 203)], 100, 0, 2).dx).toBe(100);
});
it("aligns an item's top as well as its base up the z axis", () => {
  const block = { ...node("b", 400), depth: 80 };
  // A flat card lifted near the block's top snaps onto it.
  const lifted = snapPrecise(moveBy({ x: 0, y: 0, z: 77 }), [node("a", 0)], [block], 1);
  expect(lifted.transform.move.z).toBe(80);
});

describe("precise transforms (constrained, gizmo, modal)", () => {
  it("step a move by the grid along each axis it moves, where nothing aligns", () => {
    const snapped = snapPrecise(moveBy({ x: 31, y: 0, z: 49 }), [node("a", 0)], [], 1);
    expect(snapped.transform.move).toEqual({ x: 40, y: 0, z: 40 });
    expect(snapped.guides).toEqual([]);
  });

  it("step a move along turned axes by the grid, along those axes", () => {
    // Axes turned a quarter about z: the first runs down the page.
    const turned = turnAbout({ x: 0, y: 0, z: 1 }, Math.PI / 2);
    const snapped = snapPrecise(moveBy({ x: 0, y: 27, z: 0 }, turned), [node("a", 0)], [], 1);
    expect(snapped.transform.move.y).toBeCloseTo(20, 9);
    expect(snapped.transform.move.x).toBeCloseTo(0, 9);
  });

  it("land a stretch on grid multiples of the selection's extent, alike every way when alike", () => {
    const grown = snapPrecise(
      { ...stillAbout({ x: 0, y: 0, z: 0 }), stretch: { x: 1.37, y: 1.37, z: 1.37 } },
      [node("a", 0)],
      [],
      1,
    );
    // 100 wide × 1.37 = 137, landed on 140.
    expect(grown.transform.stretch).toEqual({ x: 1.4, y: 1.4, z: 1.4 });
    const wider = snapPrecise(
      { ...stillAbout({ x: 0, y: 0, z: 0 }), stretch: { x: 1.37, y: 1, z: 1 } },
      [node("a", 0)],
      [],
      1,
    );
    expect(wider.transform.stretch).toEqual({ x: 1.4, y: 1, z: 1 });
  });

  it("leave a size under one grid step as it is, so a small item still scales", () => {
    const chip = { ...node("a", 0), width: 10, height: 10 };
    const grown = snapPrecise(
      { ...stillAbout({ x: 0, y: 0, z: 0 }), stretch: { x: 1.3, y: 1.3, z: 1.3 } },
      [chip],
      [],
      1,
    );
    expect(grown.transform.stretch.x).toBe(1.3);
  });

  it("step a move by the grid alike either way, halves away from zero", () => {
    const step = (x: number) => snapPrecise(moveBy({ x, y: 0, z: 0 }), [node("a", 0)], [], 1);
    expect(step(30).transform.move.x).toBe(40);
    expect(step(-30).transform.move.x).toBe(-40);
    expect(step(-29).transform.move.x).toBe(-20);
  });

  it("land an extrude on a grid multiple of the lead's depth", () => {
    const block = { ...node("a", 0), depth: 30 };
    const grown = snapPrecise({ ...stillAbout({ x: 0, y: 0, z: 0 }), extrude: 17 }, [block], [], 1);
    expect(grown.transform.extrude).toBe(10);
  });
});

describe("surfaces", () => {
  const box: CanvasNode = { ...node("box", 300), depth: 90 };
  const ball: CanvasNode = {
    id: "ball",
    type: "shape",
    shape: "sphere",
    x: 600,
    y: 0,
    width: 100,
    height: 60,
    depth: 60,
  };

  it("carried over a solid, an item stands on its top", () => {
    expect(snapToSurface(node("a", 0), [box], 300, 0)).toEqual({
      dz: 90,
      guides: [{ axis: "z", pos: 90 }],
    });
  });

  it("stands on the highest solid under its centre, and only on its footprint", () => {
    const lid: CanvasNode = { ...node("lid", 300), z: 90, depth: 10 };
    expect(snapToSurface(node("a", 0), [box, lid], 300, 0).dz).toBe(100);
    // Over the corner of a sphere's box the centre is off its footprint: open floor.
    const dot = { ...node("a", 0), width: 2, height: 2 };
    expect(snapToSurface(dot, [ball], 601, 1).dz).toBe(0);
    expect(snapToSurface(dot, [ball], 649, 29).dz).toBe(60);
  });

  it("off a pile it comes down to the floor; a raised item off every solid keeps its height", () => {
    const onBox: CanvasNode = { ...node("a", 300), z: 90 };
    expect(snapToSurface(onBox, [box], -300, 0).dz).toBe(-90);
    const shelf: CanvasNode = { ...node("shelf", 0), z: 120, depth: 12 };
    expect(snapToSurface(shelf, [box], 0, 200).dz).toBe(0);
  });

  it("flat items are no surface", () => {
    expect(snapToSurface(node("a", 0), [node("card", 300)], 300, 0)).toEqual({
      dz: 0,
      guides: [],
    });
  });
});
