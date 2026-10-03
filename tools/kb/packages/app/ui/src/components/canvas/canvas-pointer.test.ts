import { describe, expect, test } from "vitest";
import type { CanvasDoc, CanvasNode } from "@kb/canvas";
import { EMPTY_SELECTION, selectNode } from "./canvas-selection";
import {
  createPointerState,
  pointerReduce,
  type CanvasPointerEvent,
  type PointerContext,
  type PointerState,
} from "./canvas-pointer";

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
      world: { x: 0, y: 0 },
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
    world: { x: 0, y: 0 },
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
    { type: "pointer/end", screen: { x: 500, y: 500 }, world: { x: 500, y: 500 } },
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
    world: { x: 0, y: 0 },
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
    { type: "pointer/end", screen: { x: 97, y: 10 }, world: { x: 97, y: 10 } },
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
      world: { x: 0, y: 0 },
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
      world: { x: 0, y: 0 },
    });
    const active = reduce(started.state, {
      type: "pointer/move",
      screen: { x: -60, y: -40 },
      world: { x: -60, y: -40 },
      shiftKey: true,
    });
    const released = reduce(
      active.state,
      {
        type: "pointer/end",
        screen: { x: -60, y: -40 },
        world: { x: -60, y: -40 },
        shiftKey: true,
      },
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

describe("lift", () => {
  test("a drag up raises the carried cards by whole units at the current zoom", () => {
    const ctx = { ...context(), zoom: 2 };
    const started = reduce(
      createPointerState(),
      { type: "lift/start", id: moving.id, screen: { x: 0, y: 100 }, world: { x: 0, y: 0 } },
      ctx,
    );
    const still = reduce(
      started.state,
      { type: "pointer/move", screen: { x: 0, y: 98 }, world: { x: 0, y: 0 }, shiftKey: false },
      ctx,
    );
    // Inside the slop nothing moves.
    expect(still.doc).toBeUndefined();
    const lifted = reduce(
      started.state,
      { type: "pointer/move", screen: { x: 0, y: 41 }, world: { x: 0, y: 0 }, shiftKey: false },
      ctx,
    );
    expect(lifted.doc?.nodes.find((n) => n.id === moving.id)?.z).toBe(30);
    expect(lifted.persist).toBe("silent");
    const released = reduce(
      lifted.state,
      { type: "pointer/end", screen: { x: 0, y: 100 }, world: { x: 0, y: 0 } },
      { ...context(lifted.doc), zoom: 2 },
    );
    // Back where it started, the card carries no elevation at all.
    expect(released.doc?.nodes.find((n) => n.id === moving.id)).not.toHaveProperty("z");
    expect(released.persist).toBe("history");
  });

  test("a lift snaps to the height another card stands at", () => {
    const shelf = { ...guide, z: 40 };
    const ctx = context({ nodes: [moving, shelf], edges: [] });
    const started = reduce(
      createPointerState(),
      { type: "lift/start", id: moving.id, screen: { x: 0, y: 100 }, world: { x: 0, y: 0 } },
      ctx,
    );
    const lifted = reduce(
      started.state,
      { type: "pointer/move", screen: { x: 0, y: 63 }, world: { x: 0, y: 0 }, shiftKey: false },
      ctx,
    );
    expect(lifted.doc?.nodes.find((n) => n.id === moving.id)?.z).toBe(40);
    expect(lifted.state.snapGuides).toEqual([{ axis: "z", pos: 40 }]);
  });
});

describe("stacking", () => {
  test("a card carried onto a solid stands on its top, and comes down off it", () => {
    const block = { ...guide, x: 300, y: 300, depth: 70 };
    const ctx = context({ nodes: [moving, block], edges: [] });
    const started = reduce(
      createPointerState(),
      { type: "move/start", id: moving.id, screen: { x: 0, y: 0 }, world: { x: 0, y: 0 } },
      ctx,
    );
    const over = reduce(
      started.state,
      {
        type: "pointer/move",
        screen: { x: 20, y: 20 },
        world: { x: 310, y: 310 },
        shiftKey: false,
      },
      ctx,
    );
    const stacked = over.doc?.nodes.find((n) => n.id === moving.id);
    expect(stacked?.z).toBe(70);
    expect(over.state.snapGuides).toContainEqual({ axis: "z", pos: 70 });
    const released = reduce(
      over.state,
      { type: "pointer/end", screen: { x: 20, y: 20 }, world: { x: 310, y: 310 } },
      context(over.doc),
    );
    expect(released.doc?.nodes.find((n) => n.id === moving.id)?.z).toBe(70);
    expect(released.persist).toBe("history");

    // Picked up again and carried off: back on the floor, with no elevation written.
    const onTop = released.doc ?? doc;
    const again = reduce(
      createPointerState(),
      { type: "move/start", id: moving.id, screen: { x: 0, y: 0 }, world: { x: 0, y: 0 } },
      context(onTop),
    );
    const off = reduce(
      again.state,
      { type: "pointer/move", screen: { x: 30, y: 30 }, world: { x: -700, y: 0 }, shiftKey: false },
      context(onTop),
    );
    expect(off.doc?.nodes.find((n) => n.id === moving.id)).not.toHaveProperty("z");
  });
});

describe("turning", () => {
  /** A press on `moving`'s rotate handle, above its centre (50, 30), then a drag to `world`. */
  function turnTo(world: { x: number; y: number }, free = false) {
    const started = reduce(createPointerState(), {
      type: "turn/start",
      id: moving.id,
      screen: { x: 50, y: -10 },
      world: { x: 50, y: -10 },
    });
    return reduce(started.state, {
      type: "pointer/move",
      screen: { x: world.x, y: world.y },
      world,
      shiftKey: false,
      free,
    });
  }

  test("the rotate handle turns the item about its centre in 15° steps, previewed then written", () => {
    // From straight above the centre to 47° clockwise of it: snapped to 45°.
    const swing = (47 * Math.PI) / 180;
    const at = { x: 50 + 40 * Math.sin(swing), y: 30 - 40 * Math.cos(swing) };
    const turned = turnTo(at);
    expect(turned.persist).toBe("silent");
    const shown = turned.doc?.nodes.find((n) => n.id === moving.id);
    expect(shown?.rotation).toEqual({ z: 45 });
    // Turned about its centre: its footprint box stays where it was.
    expect([shown?.x, shown?.y]).toEqual([0, 0]);
    const released = reduce(
      turned.state,
      { type: "pointer/end", screen: at, world: at },
      context(turned.doc),
    );
    expect(released.persist).toBe("history");
    expect(released.doc?.nodes.find((n) => n.id === moving.id)?.rotation).toEqual({ z: 45 });
  });

  test("holding ⌘ turns it freely", () => {
    const swing = (47 * Math.PI) / 180;
    const turned = turnTo({ x: 50 + 40 * Math.sin(swing), y: 30 - 40 * Math.cos(swing) }, true);
    const z = turned.doc?.nodes.find((n) => n.id === moving.id)?.rotation?.z ?? 0;
    expect(z).toBeCloseTo(47, 3);
  });

  test("a handle that reports whole transforms is previewed and written the same way", () => {
    const started = reduce(createPointerState(), { type: "transform/start" });
    const lifted = reduce(started.state, {
      type: "transform/move",
      transform: {
        pivot: { x: 50, y: 30, z: 0 },
        move: { x: 0, y: 0, z: 25 },
        turn: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        stretch: { axes: [1, 0, 0, 0, 1, 0, 0, 0, 1], by: { x: 1, y: 1, z: 1 } },
      },
    });
    expect(lifted.persist).toBe("silent");
    expect(lifted.doc?.nodes.find((n) => n.id === moving.id)?.z).toBe(25);
    const released = reduce(
      lifted.state,
      { type: "pointer/end", screen: { x: 0, y: 0 }, world: { x: 0, y: 0 } },
      context(lifted.doc),
    );
    expect(released.persist).toBe("history");
    expect(released.doc?.nodes.find((n) => n.id === moving.id)?.z).toBe(25);
  });

  test("a turned item resizes along its own sides, its far corner held", () => {
    const spun: CanvasNode = { ...moving, rotation: { z: 90 } };
    const ctx = context({ nodes: [spun], edges: [] });
    // Turned a quarter, its own width runs down the page: dragging its east handle down widens it.
    const started = reduce(
      createPointerState(),
      {
        type: "resize/start",
        id: spun.id,
        corner: "se",
        screen: { x: 0, y: 0 },
        world: { x: 0, y: 0 },
      },
      ctx,
    );
    const grown = reduce(
      started.state,
      { type: "pointer/move", screen: { x: 0, y: 40 }, world: { x: 0, y: 40 }, shiftKey: false },
      ctx,
    );
    const shown = grown.doc?.nodes.find((n) => n.id === spun.id);
    expect(shown?.width).toBeCloseTo(140, 6);
    expect(shown?.height).toBeCloseTo(60, 6);
    // Its centre moved half the growth along its own width: down the page.
    expect((shown?.x ?? 0) + (shown?.width ?? 0) / 2).toBeCloseTo(50, 6);
    expect((shown?.y ?? 0) + (shown?.height ?? 0) / 2).toBeCloseTo(50, 6);
  });

  test("holding ⌘ moves without snapping to alignments", () => {
    const started = reduce(createPointerState(), {
      type: "move/start",
      id: moving.id,
      screen: { x: 0, y: 0 },
      world: { x: 0, y: 0 },
    });
    // 3 units shy of lining up with `guide`'s left edge (200).
    const near = { x: 97, y: 0 };
    const snapped = reduce(started.state, {
      type: "pointer/move",
      screen: near,
      world: near,
      shiftKey: false,
    });
    expect(snapped.doc?.nodes.find((n) => n.id === moving.id)?.x).toBe(100);
    const free = reduce(started.state, {
      type: "pointer/move",
      screen: near,
      world: near,
      shiftKey: false,
      free: true,
    });
    expect(free.doc?.nodes.find((n) => n.id === moving.id)?.x).toBe(97);
  });
});
