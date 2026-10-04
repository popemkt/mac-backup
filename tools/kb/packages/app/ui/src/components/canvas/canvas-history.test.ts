import { describe, expect, test } from "vitest";
import type { CanvasDoc } from "@kb/canvas";
import {
  adoptStored,
  canvasContent,
  canRedo,
  canUndo,
  initHistory,
  pushHistory,
  redo,
  undo,
} from "./canvas-history";

const d0: CanvasDoc = { nodes: [], edges: [] };
const d1: CanvasDoc = {
  nodes: [{ id: "a", type: "text", text: "", x: 0, y: 0, width: 100, height: 60 }],
  edges: [],
};
const d2: CanvasDoc = {
  nodes: [
    { id: "a", type: "text", text: "", x: 0, y: 0, width: 100, height: 60 },
    { id: "b", type: "text", text: "", x: 100, y: 0, width: 100, height: 60 },
  ],
  edges: [],
};

describe("canvas history", () => {
  test("initial state has no undo/redo", () => {
    const h = initHistory(d0);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(h.present).toBe(d0);
  });

  test("push adds to past and clears future", () => {
    let h = initHistory(d0);
    h = pushHistory(h, d1);
    expect(h.present).toBe(d1);
    expect(h.past).toEqual([d0]);
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
  });

  test("push same ref is a no-op", () => {
    const h = initHistory(d0);
    const h2 = pushHistory(h, d0);
    expect(h2).toBe(h);
  });

  test("undo restores previous state", () => {
    let h = initHistory(d0);
    h = pushHistory(h, d1);
    h = undo(h);
    expect(h.present).toBe(d0);
    expect(canRedo(h)).toBe(true);
  });

  test("redo after undo restores", () => {
    let h = initHistory(d0);
    h = pushHistory(h, d1);
    h = undo(h);
    h = redo(h);
    expect(h.present).toBe(d1);
  });

  test("push after undo clears redo stack", () => {
    let h = initHistory(d0);
    h = pushHistory(h, d1);
    h = undo(h);
    h = pushHistory(h, d2);
    expect(h.present).toBe(d2);
    expect(canRedo(h)).toBe(false);
  });

  test("undo at beginning is a no-op", () => {
    const h = initHistory(d0);
    const h2 = undo(h);
    expect(h2).toBe(h);
  });

  test("redo at end is a no-op", () => {
    let h = initHistory(d0);
    h = pushHistory(h, d1);
    const h2 = redo(h);
    expect(h2).toBe(h);
  });

  test("respects max history cap", () => {
    let h = initHistory(d0);
    for (let i = 0; i < 35; i++) {
      h = pushHistory(h, { nodes: [], edges: [], extra: { i } });
    }
    expect(h.past.length).toBeLessThanOrEqual(30);
  });

  test("multiple undo/redo roundtrip", () => {
    let h = initHistory(d0);
    h = pushHistory(h, d1);
    h = pushHistory(h, d2);
    h = undo(h);
    expect(h.present).toBe(d1);
    h = undo(h);
    expect(h.present).toBe(d0);
    h = redo(h);
    expect(h.present).toBe(d1);
    h = redo(h);
    expect(h.present).toBe(d2);
  });
});

/** A canvas that has written nothing. */
const none = () => false;

describe("what the store holds, taken in", () => {
  test("a late echo of the canvas's own write changes nothing: an undo past it holds", () => {
    // Wrote d1 then d2, then undid back to d1; d2's echo arrives late.
    const undone = undo(pushHistory(initHistory(d1), d2));
    const sent = new Set([canvasContent(d1), canvasContent(d2)]);
    const h = adoptStored(undone, d2, (content) => sent.has(content));
    expect(h).toBe(undone);
    expect(h.future).toHaveLength(1);
  });

  test("an edit made elsewhere — an agent's verb — is one step, which undo takes back", () => {
    const h = adoptStored(initHistory(d1), d2, none);
    expect(h.present).toBe(d2);
    expect(undo(h).present).toBe(d1);
  });

  test("the store echoing what is shown changes nothing", () => {
    const h = initHistory(d1);
    expect(adoptStored(h, { ...d1, nodes: [...d1.nodes] }, none)).toBe(h);
  });

  test("a change of the camera alone is view state: taken in, with no step", () => {
    const camera = { projection: "3d" as const };
    const h = adoptStored(initHistory(d1), { ...d1, camera }, none);
    expect(h.present.camera).toEqual(camera);
    expect(canUndo(h)).toBe(false);
  });
});
