import { describe, expect, it } from "vitest";
import type { CanvasNode } from "@kb/canvas";
import { screenBounds, viewOfPan } from "./canvas-camera";
import { visibleItemIds } from "./canvas-visible";

function item(id: string, x: number, y: number, width = 100, height = 50): CanvasNode {
  return { id, type: "text", text: id, x, y, width, height };
}

const size = { width: 400, height: 300 };
/** The 2D camera of a CSS pan and zoom on that stage. */
const flat = (pan: { x: number; y: number }, zoom: number) => viewOfPan(pan, zoom, size);

describe("visibleItemIds", () => {
  const items = [item("a", 0, 0), item("b", 500, 0), item("c", -150, -80)];

  it("keeps the items that reach into the stage, in document order", () => {
    expect(visibleItemIds(items, flat({ x: 0, y: 0 }, 1), size)).toEqual(["a"]);
  });

  it("follows the pan and the zoom", () => {
    // Panned right by 200px: canvas x from -200 to 200 is on screen.
    expect(visibleItemIds(items, flat({ x: 200, y: 100 }, 1), size)).toEqual(["a", "c"]);
    // Zoomed out to a half: canvas 0..800 wide is on screen.
    expect(visibleItemIds(items, flat({ x: 0, y: 0 }, 0.5), size)).toEqual(["a", "b"]);
  });

  it("in perspective, sees what is in front of the eye and inside the frame", () => {
    const view = { x: 50, y: 25, z: 0, zoom: 1, yaw: 0, pitch: 0, fov: 40 };
    const behind = { ...item("behind", 0, 0), z: 1e6 };
    const far = item("far", 4000, 0);
    expect(visibleItemIds([items[0] as CanvasNode, behind, far], view, size)).toEqual(["a"]);
    expect(screenBounds(view, size, behind)).toBeNull();
    // Tipped toward level, a long item runs from in front of the eye to behind it.
    const tipped = { ...view, pitch: 1.2 };
    const across = item("across", 0, -1000, 100, 1e6);
    const drawn = screenBounds(tipped, size, across);
    expect(drawn).not.toBeNull();
    expect(Number.isFinite(drawn?.bottom)).toBe(true);
    expect(visibleItemIds([across], tipped, size)).toEqual(["across"]);
  });

  it("sees nothing through a stage with no size", () => {
    expect(visibleItemIds(items, flat({ x: 0, y: 0 }, 1), { width: 0, height: 0 })).toEqual([]);
  });
});
