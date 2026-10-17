/**
 * A stroke drawn by hand through the pointer reducer (`stroke/start`): the
 * draw and highlight tools, in either projection.
 */
import { describe, expect, test } from "vitest";
import { canvasMembership, type CanvasDoc, type CanvasNode } from "@kb/canvas";
import { EMPTY_SELECTION } from "./canvas-selection";
import { viewOfPan } from "./canvas-camera";
import { createPointerState, pointerReduce, type PointerContext } from "./canvas-pointer";

const note: CanvasNode = { id: "n", type: "text", text: "n", x: 0, y: 0, width: 100, height: 60 };
const doc: CanvasDoc = { nodes: [note], edges: [] };
const size = { width: 800, height: 600 };
/** The top view with no pan at 1:1: a screen point is the canvas point it stands over. */
const top = viewOfPan({ x: 0, y: 0 }, 1, size);

function context(stateDoc: CanvasDoc): PointerContext {
  return {
    doc: stateDoc,
    membership: canvasMembership(stateDoc.nodes),
    scope: null,
    selection: EMPTY_SELECTION,
    byId: new Map(stateDoc.nodes.map((node) => [node.id, node])),
    view: top,
    size,
  };
}

describe("a stroke drawn by hand", () => {
  /** Runs a stroke through `screens` (the first where it went down), as the pointer would. */
  function draw(screens: readonly { x: number; y: number }[], base: CanvasDoc = doc) {
    const [first = { x: 0, y: 0 }, ...rest] = screens;
    let ctx = context(base);
    let step = pointerReduce(
      createPointerState(),
      { type: "stroke/start", id: "ink", highlight: false, screen: first },
      ctx,
    );
    const persists: (string | undefined)[] = [];
    for (const screen of rest.slice(0, -1)) {
      step = pointerReduce(step.state, { type: "pointer/move", screen, shiftKey: false }, ctx);
      persists.push(step.persist);
      ctx = context(step.doc ?? ctx.doc);
    }
    const end = pointerReduce(
      step.state,
      { type: "pointer/end", screen: rest.at(-1) ?? first },
      ctx,
    );
    return { end, persists };
  }

  test("is written as it runs, then placed as one history step: a smooth path through it", () => {
    const { end, persists } = draw([
      { x: 400, y: 100 },
      { x: 420, y: 140 },
      { x: 450, y: 110 },
      { x: 480, y: 150 },
    ]);
    expect(persists).toEqual(["silent", "silent"]);
    expect(end.persist).toBe("history");
    expect(end.state.drag).toBeNull();
    const ink = end.doc?.nodes.find((n) => n.id === "ink");
    expect(ink).toMatchObject({
      type: "path",
      freehand: true,
      x: 400,
      y: 100,
      width: 80,
      height: 50,
    });
  });

  test("a stroke that never left where it went down leaves nothing", () => {
    const { end } = draw([
      { x: 400, y: 100 },
      { x: 400.5, y: 100 },
    ]);
    expect(end.persist).toBe("cancel");
    expect(end.doc).toBeUndefined();
  });

  test("drawn inside a frame, it belongs to the frame", () => {
    const frame: CanvasNode = { id: "f", type: "group", x: 380, y: 80, width: 200, height: 120 };
    const { end } = draw(
      [
        { x: 400, y: 100 },
        { x: 440, y: 130 },
        { x: 480, y: 150 },
      ],
      { nodes: [...doc.nodes, frame], edges: [] },
    );
    expect(end.doc?.nodes.find((n) => n.id === "ink")?.parent).toBe("f");
  });
});
