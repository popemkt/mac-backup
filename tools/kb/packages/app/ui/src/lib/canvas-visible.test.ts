import { describe, expect, it } from "vitest";
import type { CanvasNode } from "@kb/canvas";
import { visibleItemIds } from "@/lib/canvas-visible";

function item(id: string, x: number, y: number, width = 100, height = 50): CanvasNode {
  return { id, type: "text", text: id, x, y, width, height };
}

describe("visibleItemIds", () => {
  const items = [item("a", 0, 0), item("b", 500, 0), item("c", -150, -80)];

  it("keeps the items that reach into the stage, in document order", () => {
    expect(
      visibleItemIds(items, { pan: { x: 0, y: 0 }, zoom: 1, width: 400, height: 300 }),
    ).toEqual(["a"]);
  });

  it("follows the pan and the zoom", () => {
    // Panned right by 200px: canvas x from -200 to 200 is on screen.
    expect(
      visibleItemIds(items, { pan: { x: 200, y: 100 }, zoom: 1, width: 400, height: 300 }),
    ).toEqual(["a", "c"]);
    // Zoomed out to a half: canvas 0..800 wide is on screen.
    expect(
      visibleItemIds(items, { pan: { x: 0, y: 0 }, zoom: 0.5, width: 400, height: 300 }),
    ).toEqual(["a", "b"]);
  });

  it("sees nothing through a stage with no size", () => {
    expect(visibleItemIds(items, { pan: { x: 0, y: 0 }, zoom: 1, width: 0, height: 0 })).toEqual(
      [],
    );
  });
});
