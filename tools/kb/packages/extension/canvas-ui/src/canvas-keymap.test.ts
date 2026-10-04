import { describe, expect, test } from "vitest";
import {
  CANVAS_VIEW_COMMANDS,
  mapCanvasKey,
  type CanvasIntent,
  type CanvasKeyEvent,
} from "./canvas-keymap";
import { ZOOM_STEP } from "./canvas-camera";

const withSelection = { selectionEmpty: false, transforming: false };
const empty = { selectionEmpty: true, transforming: false };
const transforming = { selectionEmpty: false, transforming: true };

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
    [chord("g"), { type: "transform", act: { kind: "begin", mode: "grab" } }],
    [chord("s"), { type: "transform", act: { kind: "begin", mode: "scale" } }],
    [chord("e"), { type: "transform", act: { kind: "begin", mode: "extrude" } }],
    [chord("n"), { type: "tool", tool: "kb-node" }],
    [chord("b"), { type: "tool", tool: "solid" }],
    [chord("8"), { type: "tool", tool: "solid" }],
    [chord("=", { metaKey: true }), { type: "zoomBy", factor: ZOOM_STEP }],
    [chord("+", { metaKey: true }), { type: "zoomBy", factor: ZOOM_STEP }],
    [chord("-", { metaKey: true }), { type: "zoomBy", factor: 1 / ZOOM_STEP }],
    [chord("0", { metaKey: true }), { type: "zoomTo", zoom: 1 }],
    [chord("!", { shiftKey: true }), { type: "frame", scope: "all" }],
    [chord("@", { code: "Digit2", shiftKey: true }), { type: "frame", scope: "selection" }],
    [chord("Delete", { code: "NumpadDecimal" }), { type: "frame", scope: "selection" }],
    [chord("Home", { code: "Numpad7" }), { type: "look", preset: "top" }],
    [chord("End", { code: "Numpad1", ctrlKey: true }), { type: "look", preset: "back" }],
    [chord("5", { code: "Numpad5" }), { type: "toggleLens" }],
    [chord("`", { code: "Backquote" }), { type: "viewMenu" }],
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
    // A tool is a plain key: ⌘1 and ⌘V stay the browser's.
    expect(mapCanvasKey(chord("1", { metaKey: true }), withSelection)).toBeNull();
    expect(mapCanvasKey(chord("v", { metaKey: true }), withSelection)).toBeNull();
  });

  test("⌘0 falls past the tool keys to the zoom reset", () => {
    expect(mapCanvasKey(chord("0", { metaKey: true }), withSelection)?.intent).toEqual({
      type: "zoomTo",
      zoom: 1,
    });
  });
});

describe("a modal transform (G, S, E)", () => {
  test("G, S and E need a selection, and G no longer picks the group tool", () => {
    expect(mapCanvasKey(chord("g"), empty)).toEqual({ intent: null, preventDefault: true });
    expect(mapCanvasKey(chord("e", { shiftKey: true }), withSelection)).toBeNull();
  });

  const table: [CanvasKeyEvent, CanvasIntent | null][] = [
    [
      chord("x"),
      { type: "transform", act: { kind: "key", key: { kind: "axis", axis: "x", plane: false } } },
    ],
    [
      chord("Z", { shiftKey: true }),
      { type: "transform", act: { kind: "key", key: { kind: "axis", axis: "z", plane: true } } },
    ],
    [
      chord("r"),
      { type: "transform", act: { kind: "key", key: { kind: "mode", mode: "rotate" } } },
    ],
    [chord("s"), { type: "transform", act: { kind: "key", key: { kind: "mode", mode: "scale" } } }],
    [chord("3"), { type: "transform", act: { kind: "key", key: { kind: "type", key: "3" } } }],
    [chord("."), { type: "transform", act: { kind: "key", key: { kind: "type", key: "." } } }],
    [chord("-"), { type: "transform", act: { kind: "key", key: { kind: "type", key: "-" } } }],
    [
      chord("Backspace"),
      { type: "transform", act: { kind: "key", key: { kind: "type", key: "Backspace" } } },
    ],
    [
      chord("4", { code: "Numpad4" }),
      { type: "transform", act: { kind: "key", key: { kind: "type", key: "4" } } },
    ],
    [chord("Enter"), { type: "transform", act: { kind: "confirm" } }],
    [chord("Escape"), { type: "transform", act: { kind: "cancel" } }],
    [chord("Meta"), { type: "transform", act: { kind: "free" } }],
    // Everything else does nothing mid-transform: no tool, no delete, no undo.
    [chord("t"), null],
    [chord("Delete"), null],
    [chord("z", { metaKey: true }), null],
  ];

  test.each(table)("during one, %o maps to %o", (event, intent) => {
    expect(mapCanvasKey(event, transforming)?.intent).toEqual(intent);
  });

  test("a held key acts once (no axis cycling, no run of digits); Backspace repeats", () => {
    expect(mapCanvasKey(chord("x", { repeat: true }), transforming)?.intent).toBeNull();
    expect(mapCanvasKey(chord("7", { repeat: true }), transforming)?.intent).toBeNull();
    expect(mapCanvasKey(chord("Backspace", { repeat: true }), transforming)?.intent).toEqual({
      type: "transform",
      act: { kind: "key", key: { kind: "type", key: "Backspace" } },
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

  test("⌘G groups and ⌘⇧G ungroups the selection, and the browser's find-next never runs", () => {
    expect(mapCanvasKey(chord("g", { metaKey: true }), withSelection)).toEqual({
      intent: { type: "group" },
      preventDefault: true,
    });
    expect(mapCanvasKey(chord("G", { ctrlKey: true, shiftKey: true }), withSelection)).toEqual({
      intent: { type: "ungroup" },
      preventDefault: true,
    });
    expect(mapCanvasKey(chord("g", { metaKey: true }), empty)).toEqual({
      intent: null,
      preventDefault: true,
    });
  });

  test("while frames are presented their keys come first; a modal transform's still before them", () => {
    const presenting = { ...withSelection, presenting: true };
    const act = (event: CanvasKeyEvent) => mapCanvasKey(event, presenting)?.intent;
    expect(act(chord("ArrowRight"))).toEqual({ type: "present", act: "next" });
    expect(act(chord("ArrowUp"))).toEqual({ type: "present", act: "previous" });
    expect(act(chord(" ", { shiftKey: true }))).toEqual({ type: "present", act: "previous" });
    expect(mapCanvasKey(chord("Escape"), presenting)).toEqual({
      intent: { type: "present", act: "stop" },
      preventDefault: false,
    });
    // Anything else means what it always does, and ⌘ chords are never the deck's.
    expect(act(chord("r"))).toEqual({ type: "tool", tool: "rect" });
    expect(act(chord("ArrowRight", { metaKey: true }))).not.toEqual({
      type: "present",
      act: "next",
    });
    expect(mapCanvasKey(chord("Escape"), { ...transforming, presenting: true })?.intent).toEqual({
      type: "transform",
      act: { kind: "cancel" },
    });
  });

  test("the view menu's table can start presenting", () => {
    expect(CANVAS_VIEW_COMMANDS.map((c) => c.intent)).toContainEqual({
      type: "present",
      act: "start",
    });
  });

  test("⌘V is not claimed, so the browser raises its paste; select-all needs no selection", () => {
    expect(mapCanvasKey(chord("v", { metaKey: true }), empty)).toBeNull();
    expect(mapCanvasKey(chord("a", { metaKey: true }), empty)?.intent).toEqual({
      type: "selectAll",
    });
  });
});
