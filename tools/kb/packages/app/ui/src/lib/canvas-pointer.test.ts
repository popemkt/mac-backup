import { describe, expect, test } from "vitest";
import type { CanvasDoc, CanvasNode } from "@kb/canvas";
import { EMPTY_SELECTION, selectNode } from "@/lib/canvas-selection";
import {
  createPointerState,
  pointerReduce,
  type CanvasPointerEvent,
  type PointerContext,
  type PointerState,
} from "@/lib/canvas-pointer";

const moving: CanvasNode = {
  id: "moving",
  type: "shape",
  shape: "rect",
  x: 0,
  y: 0,
  width: 100,
  height: 60,
};
const guide: CanvasNode = {
  id: "guide",
  type: "shape",
  shape: "rect",
  x: 200,
  y: 0,
  width: 100,
  height: 60,
};
const doc: CanvasDoc = { nodes: [moving, guide], edges: [] };

function context(stateDoc: CanvasDoc = doc, selection = selectNode(moving.id)): PointerContext {
  return {
    doc: stateDoc,
    selection,
    zoom: 1,
    byId: new Map(stateDoc.nodes.map((node) => [node.id, node])),
  };
}

function reduce(state: PointerState, event: CanvasPointerEvent, ctx: PointerContext = context()) {
  return pointerReduce(state, event, ctx);
}

test("a move without a prior down is a no-op", () => {
  const state = createPointerState();
  const next = reduce(state, {
    type: "pointer/move",
    screen: { x: 20, y: 20 },
    world: { x: 20, y: 20 },
    shiftKey: false,
  });
  expect(next.state).toBe(state);
  expect(next.doc).toBeUndefined();
});

describe("resize", () => {
  test.each(["nw", "ne", "se", "sw"] as const)("%s never inverts a rectangle", (corner) => {
    const started = reduce(createPointerState(), {
      type: "resize/start",
      id: moving.id,
      corner,
      screen: { x: 0, y: 0 },
    }).state;
    const active = reduce(started, {
      type: "pointer/move",
      screen: { x: 1_000, y: 1_000 },
      world: { x: 1_000, y: 1_000 },
      shiftKey: false,
    }).state;
    const resized = reduce(active, {
      type: "pointer/move",
      screen: { x: 1_000, y: 1_000 },
      world: { x: 1_000, y: 1_000 },
      shiftKey: false,
    }).doc?.nodes.find((node) => node.id === moving.id);
    expect(resized?.width).toBeGreaterThanOrEqual(80);
    expect(resized?.height).toBeGreaterThanOrEqual(40);
  });
});

test("snapping only moves toward the guide", () => {
  const started = reduce(createPointerState(), {
    type: "move/start",
    id: moving.id,
    screen: { x: 0, y: 0 },
  }).state;
  const active = reduce(started, {
    type: "pointer/move",
    screen: { x: 97, y: 10 },
    world: { x: 97, y: 10 },
    shiftKey: false,
  }).state;
  const beforeDistance = Math.abs(moving.x + moving.width + 97 - guide.x);
  const moved = reduce(active, {
    type: "pointer/move",
    screen: { x: 97, y: 10 },
    world: { x: 97, y: 10 },
    shiftKey: false,
  });
  const snapped = moved.doc?.nodes.find((node) => node.id === moving.id);
  const afterDistance = Math.abs((snapped?.x ?? 0) + moving.width - guide.x);
  expect(moved.guides).toContainEqual({ axis: "x", pos: guide.x });
  expect(afterDistance).toBeLessThan(beforeDistance);
});

test("an edge drag that ends off-port creates nothing", () => {
  const started = reduce(
    createPointerState(),
    {
      type: "edge/start",
      fromCardId: moving.id,
      fromSide: "right",
      screen: { x: 100, y: 30 },
    },
    context(doc, EMPTY_SELECTION),
  ).state;
  const ended = reduce(
    started,
    { type: "pointer/end", screen: { x: 500, y: 500 } },
    context(doc, EMPTY_SELECTION),
  );
  expect(ended.doc).toBeUndefined();
  expect(ended.state.drag).toBeNull();
});
