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

test("the release persists the snapped position the drag showed", () => {
  const started = reduce(createPointerState(), {
    type: "move/start",
    id: moving.id,
    screen: { x: 0, y: 0 },
  });
  const dragged = reduce(started.state, {
    type: "pointer/move",
    screen: { x: 97, y: 10 },
    world: { x: 97, y: 10 },
    shiftKey: false,
  });
  const shown = dragged.doc?.nodes.find((node) => node.id === moving.id);
  // 97 raw pixels; the right edge snaps the last 3 onto the guide's left edge.
  expect(shown?.x).toBe(guide.x - moving.width);

  const released = reduce(
    dragged.state,
    { type: "pointer/end", screen: { x: 97, y: 10 } },
    context(dragged.doc),
  );
  const persisted = released.doc?.nodes.find((node) => node.id === moving.id);
  expect(persisted?.x).toBe(shown?.x);
  expect(released.persist).toBe("history");
  expect(released.state.snapGuides).toEqual([]);
});

describe("shift-locked resize", () => {
  const corners = ["nw", "ne", "se", "sw"] as const;
  const deltas = [
    { x: -60, y: -40 },
    { x: 60, y: 40 },
    { x: -60, y: 40 },
    { x: 60, y: -40 },
    { x: 24, y: -8 },
  ];
  const cases = corners.flatMap((corner) => deltas.map((delta) => [corner, delta] as const));

  test.each(cases)("%s keeps its anchored corner pinned (%o)", (corner, delta) => {
    const started = reduce(createPointerState(), {
      type: "resize/start",
      id: moving.id,
      corner,
      screen: { x: 0, y: 0 },
    });
    const resized = reduce(started.state, {
      type: "pointer/move",
      screen: delta,
      world: delta,
      shiftKey: true,
    }).doc?.nodes.find((node) => node.id === moving.id);
    expect(resized).toBeDefined();
    if (!resized) return;
    // Dragging a west corner pins the east edge, and vice versa; a north
    // corner pins the south edge. The ratio lock may not move either.
    if (corner.endsWith("w")) expect(resized.x + resized.width).toBe(moving.x + moving.width);
    else expect(resized.x).toBe(moving.x);
    if (corner.startsWith("n")) expect(resized.y + resized.height).toBe(moving.y + moving.height);
    else expect(resized.y).toBe(moving.y);
  });

  test("the anchor survives the release, not just the drag", () => {
    const started = reduce(createPointerState(), {
      type: "resize/start",
      id: moving.id,
      corner: "nw",
      screen: { x: 0, y: 0 },
    });
    const active = reduce(started.state, {
      type: "pointer/move",
      screen: { x: -60, y: -40 },
      world: { x: -60, y: -40 },
      shiftKey: true,
    });
    const released = reduce(
      active.state,
      { type: "pointer/end", screen: { x: -60, y: -40 }, shiftKey: true },
      context(active.doc),
    );
    const persisted = released.doc?.nodes.find((node) => node.id === moving.id);
    // The ratio lock shortened the height; the south-east corner still sits
    // where it did, so the card scaled in place instead of sliding.
    expect(persisted?.height).toBeLessThan(100);
    expect((persisted?.x ?? 0) + (persisted?.width ?? 0)).toBe(moving.x + moving.width);
    expect((persisted?.y ?? 0) + (persisted?.height ?? 0)).toBe(moving.y + moving.height);
    expect(released.persist).toBe("history");
  });
});
