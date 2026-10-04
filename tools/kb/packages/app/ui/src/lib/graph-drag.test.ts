import { describe, expect, it } from "vitest";
import { NodeDrag, type DragLayout, type DragSurface, type LayoutPoint } from "./graph-drag";
import { POINTER_SLOP } from "@kb/ui-sdk";

function rig() {
  const calls: string[] = [];
  const held: LayoutPoint[] = [];
  const layout: DragLayout = {
    grab: (id) => calls.push(`grab ${id}`),
    hold: (id, at) => {
      calls.push(`hold ${id}`);
      held.push(at);
    },
    drop: (id) => calls.push(`drop ${id}`),
  };
  const surface: DragSurface = {
    suspend: () => calls.push("suspend"),
    resume: () => calls.push("resume"),
    // The node stands 10 right of where it was pressed: the grip keeps that offset.
    grip: (id, x, y) => {
      calls.push(`grip ${id} ${x},${y}`);
      return (px, py) => ({ x: px - x + 10, y: py - y });
    },
  };
  return { calls, held, drag: new NodeDrag(() => layout, surface) };
}

describe("NodeDrag", () => {
  it("a press that stays within the slop is a click: the layout never grabs", () => {
    const { calls, drag } = rig();
    drag.down("a", 0, 0);
    expect(drag.move(POINTER_SLOP, 0)).toBe(false);
    expect(drag.pressed).toBe("a");
    expect(drag.dragging).toBeNull();
    expect(drag.up()).toBe(false);
    expect(calls).toEqual(["suspend", "resume"]);
  });

  it("past the slop it grips at the press, grabs, holds each move and drops on release", () => {
    const { calls, held, drag } = rig();
    drag.down("a", 5, 5);
    expect(drag.move(5 + POINTER_SLOP + 1, 5)).toBe(true);
    expect(drag.dragging).toBe("a");
    drag.move(30, 25);
    expect(drag.up()).toBe(true);
    expect(drag.pressed).toBeNull();
    expect(calls).toEqual([
      "suspend",
      "grip a 5,5",
      "grab a",
      "hold a",
      "hold a",
      "drop a",
      "resume",
    ]);
    expect(held).toEqual([
      { x: POINTER_SLOP + 11, y: 0 },
      { x: 35, y: 20 },
    ]);
  });

  it("a new press ends the one before it", () => {
    const { calls, drag } = rig();
    drag.down("a", 0, 0);
    drag.move(20, 0);
    drag.down("b", 0, 0);
    expect(drag.pressed).toBe("b");
    expect(calls).toContain("drop a");
    expect(drag.up()).toBe(false);
  });
});
