import { expect, it } from "vitest";
import type { CanvasNode } from "@kb/canvas";
import { snapCanvasMove } from "./canvas-snap";

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
it("keeps snapping tolerance consistent in screen pixels", () => {
  expect(snapCanvasMove(node("a", 0), [node("b", 208)], 100, 0, 0.5).dx).toBe(108);
  expect(snapCanvasMove(node("a", 0), [node("b", 203)], 100, 0, 2).dx).toBe(100);
});
