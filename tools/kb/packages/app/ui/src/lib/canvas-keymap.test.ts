import { describe, expect, test } from "vitest";
import { mapCanvasKey, type CanvasIntent, type CanvasKeyEvent } from "@/lib/canvas-keymap";
import { ZOOM_STEP } from "@/lib/canvas-viewport";

const withSelection = { selectionEmpty: false };
const empty = { selectionEmpty: true };

const chord = (key: string, extra: Partial<CanvasKeyEvent> = {}): CanvasKeyEvent => ({
  key,
  ...extra,
});

describe("with something selected", () => {
  const table: [CanvasKeyEvent, CanvasIntent][] = [
    [chord("z", { metaKey: true }), { type: "undo" }],
    [chord("z", { metaKey: true, shiftKey: true }), { type: "redo" }],
    [chord("Z", { metaKey: true }), { type: "redo" }],
    [chord("y", { ctrlKey: true }), { type: "redo" }],
    [chord("Delete"), { type: "delete" }],
    [chord("Backspace"), { type: "delete" }],
    [chord("a", { metaKey: true }), { type: "selectAll" }],
    [chord("c", { metaKey: true }), { type: "copy" }],
    [chord("v", { metaKey: true }), { type: "paste" }],
    [chord("d", { metaKey: true }), { type: "duplicate" }],
    [chord("Escape"), { type: "escape" }],
    [chord(" ", { code: "Space" }), { type: "panModifier" }],
    [chord("ArrowLeft"), { type: "nudge", dx: -1, dy: 0 }],
    [chord("ArrowRight"), { type: "nudge", dx: 1, dy: 0 }],
    [chord("ArrowUp"), { type: "nudge", dx: 0, dy: -1 }],
    [chord("ArrowDown"), { type: "nudge", dx: 0, dy: 1 }],
    [chord("ArrowDown", { shiftKey: true }), { type: "nudge", dx: 0, dy: 10 }],
    [chord("v"), { type: "tool", tool: "select" }],
    [chord("T"), { type: "tool", tool: "text" }],
    [chord("3"), { type: "tool", tool: "rect" }],
    [chord("c"), { type: "tool", tool: "ellipse" }],
    [chord("d"), { type: "tool", tool: "diamond" }],
    [chord("f"), { type: "tool", tool: "group" }],
    [chord("n"), { type: "tool", tool: "kb-node" }],
    [chord("=", { metaKey: true }), { type: "zoomBy", factor: ZOOM_STEP }],
    [chord("+", { metaKey: true }), { type: "zoomBy", factor: ZOOM_STEP }],
    [chord("-", { metaKey: true }), { type: "zoomBy", factor: 1 / ZOOM_STEP }],
    [chord("0", { metaKey: true }), { type: "zoomTo", zoom: 1 }],
    [chord("!", { shiftKey: true }), { type: "zoomToFit" }],
  ];

  test.each(table)("%o maps to %o", (event, intent) => {
    expect(mapCanvasKey(event, withSelection)?.intent).toEqual(intent);
  });

  test("the canvas claims nothing it has no binding for", () => {
    expect(mapCanvasKey(chord("q", { metaKey: true }), withSelection)).toBeNull();
    expect(mapCanvasKey(chord("F5"), withSelection)).toBeNull();
  });
});

describe("order between the chord maps", () => {
  test("a modifier turns a tool key into its command", () => {
    expect(mapCanvasKey(chord("c", { metaKey: true }), withSelection)?.intent).toEqual({
      type: "copy",
    });
    expect(mapCanvasKey(chord("d", { metaKey: true }), withSelection)?.intent).toEqual({
      type: "duplicate",
    });
    // ⌘1 is still the select tool: only c, d, v and a have commands.
    expect(mapCanvasKey(chord("1", { metaKey: true }), withSelection)?.intent).toEqual({
      type: "tool",
      tool: "select",
    });
  });

  test("⌘0 falls past the tool keys to the zoom reset", () => {
    expect(mapCanvasKey(chord("0", { metaKey: true }), withSelection)?.intent).toEqual({
      type: "zoomTo",
      zoom: 1,
    });
  });
});

describe("what the browser still gets", () => {
  test("Escape is claimed but not prevented", () => {
    expect(mapCanvasKey(chord("Escape"), withSelection)).toEqual({
      intent: { type: "escape" },
      preventDefault: false,
    });
  });

  test("an empty selection swallows Delete, copy and duplicate", () => {
    for (const event of [
      chord("Delete"),
      chord("Backspace"),
      chord("c", { metaKey: true }),
      chord("d", { metaKey: true }),
    ]) {
      expect(mapCanvasKey(event, empty)).toEqual({ intent: null, preventDefault: true });
    }
  });

  test("an empty selection swallows an arrow without preventing it", () => {
    expect(mapCanvasKey(chord("ArrowLeft"), empty)).toEqual({
      intent: null,
      preventDefault: false,
    });
  });

  test("paste and select-all do not need a selection", () => {
    expect(mapCanvasKey(chord("v", { metaKey: true }), empty)?.intent).toEqual({ type: "paste" });
    expect(mapCanvasKey(chord("a", { metaKey: true }), empty)?.intent).toEqual({
      type: "selectAll",
    });
  });
});
