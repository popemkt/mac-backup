import { describe, expect, it } from "vitest";
import type { CanvasNode } from "@kb/canvas";
import { snapCanvasLift, snapCanvasMove, snapToSurface } from "./canvas-snap";

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
it("lifts to the heights other items stand at, within the same tolerance", () => {
  const raised = { ...node("b", 400), z: 120 };
  expect(snapCanvasLift(node("a", 0), [raised], 117, 1)).toEqual({
    dz: 120,
    guides: [{ axis: "z", pos: 120 }],
  });
  expect(snapCanvasLift(node("a", 0), [raised], 110, 1).dz).toBe(110);
});
it("keeps snapping tolerance consistent in screen pixels", () => {
  expect(snapCanvasMove(node("a", 0), [node("b", 208)], 100, 0, 0.5).dx).toBe(108);
  expect(snapCanvasMove(node("a", 0), [node("b", 203)], 100, 0, 2).dx).toBe(100);
});
it("aligns an item's top as well as its base up the z axis", () => {
  const block = { ...node("b", 400), depth: 80 };
  // A flat card lifted near the block's top snaps onto it.
  expect(snapCanvasLift(node("a", 0), [block], 77, 1).dz).toBe(80);
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
