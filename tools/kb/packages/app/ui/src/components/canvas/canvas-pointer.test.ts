import { describe, expect, test } from "vitest";
import type { CanvasDoc, CanvasNode } from "@kb/canvas";
import { EMPTY_SELECTION, selectNode } from "./canvas-selection";
import { projectPoint, viewOfPan, type CanvasView } from "./canvas-camera";
import { ALONG_Z, type TransformKey } from "./canvas-transform-input";
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

const size = { width: 800, height: 600 };
/** The top view with no pan at 1:1: a screen point is the canvas point it stands over. */
const top = viewOfPan({ x: 0, y: 0 }, 1, size);

function context(
  stateDoc: CanvasDoc = doc,
  selection = selectNode(moving.id),
  view: CanvasView = top,
): PointerContext {
  return {
    doc: stateDoc,
    selection,
    byId: new Map(stateDoc.nodes.map((node) => [node.id, node])),
    view,
    size,
  };
}

function reduce(state: PointerState, event: CanvasPointerEvent, ctx: PointerContext = context()) {
  return pointerReduce(state, event, ctx);
}

test("a move without a prior down is a no-op", () => {
  const state = createPointerState();
  const next = reduce(state, { type: "pointer/move", screen: { x: 20, y: 20 }, shiftKey: false });
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
      shiftKey: false,
    }).state;
    const resized = reduce(active, {
      type: "pointer/move",
      screen: { x: 1_000, y: 1_000 },
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
    shiftKey: false,
  }).state;
  const beforeDistance = Math.abs(moving.x + moving.width + 97 - guide.x);
  const moved = reduce(active, { type: "pointer/move", screen: { x: 97, y: 10 }, shiftKey: false });
  const snapped = moved.doc?.nodes.find((node) => node.id === moving.id);
  const afterDistance = Math.abs((snapped?.x ?? 0) + moving.width - guide.x);
  expect(moved.guides).toContainEqual({ axis: "x", pos: guide.x });
  expect(afterDistance).toBeLessThan(beforeDistance);
});

test("an edge drag that ends off-port creates nothing", () => {
  const started = reduce(
    createPointerState(),
    { type: "edge/start", fromCardId: moving.id, fromSide: "right", screen: { x: 100, y: 30 } },
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

test("an edge drag that ends on another card's port binds them, read on the floor under it", () => {
  const started = reduce(
    createPointerState(),
    { type: "edge/start", fromCardId: moving.id, fromSide: "right", screen: { x: 100, y: 30 } },
    context(doc, EMPTY_SELECTION),
  ).state;
  const ended = reduce(
    started,
    {
      type: "pointer/end",
      screen: { x: 205, y: 30 },
      edgeTargetId: guide.id,
      edgeId: "e",
      edgeBindingId: "bind",
    },
    context(doc, EMPTY_SELECTION),
  );
  expect(ended.persist).toBe("flush");
  expect(ended.doc?.edges).toEqual([
    expect.objectContaining({
      id: "e",
      fromNode: moving.id,
      toNode: guide.id,
      fromSide: "right",
      toSide: "left",
    }),
  ]);
  expect(ended.selection?.edgeIds).toEqual(new Set(["e"]));
});

test("a marquee drawn across the floor selects what it covers, read through the camera", () => {
  const panned = viewOfPan({ x: 40, y: 40 }, 2, size);
  const ctx = context(doc, EMPTY_SELECTION, panned);
  // At 2× panned by 40: the screen point (30, 30) is the canvas point (-5, -5).
  const started = reduce(
    createPointerState(),
    { type: "marquee/start", screen: { x: 30, y: 30 }, additive: false },
    ctx,
  );
  const to = (state: PointerState) =>
    reduce(state, { type: "pointer/move", screen: { x: 300, y: 200 }, shiftKey: false }, ctx);
  const opened = to(started.state);
  expect(opened.state.marqueeRect).toEqual({ x: -5, y: -5, w: 135, h: 85 });
  expect(to(opened.state).selection?.nodeIds).toEqual(new Set([moving.id]));
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

test("a press that never goes past the slop writes nothing", () => {
  const started = reduce(createPointerState(), {
    type: "move/start",
    id: moving.id,
    screen: { x: 0, y: 0 },
  });
  const still = reduce(started.state, {
    type: "pointer/move",
    screen: { x: 2, y: 1 },
    shiftKey: false,
  });
  expect(still.doc).toBeUndefined();
  const released = reduce(still.state, { type: "pointer/end", screen: { x: 2, y: 1 } });
  expect(released.doc).toBeUndefined();
  expect(released.state.drag).toBeNull();
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

describe("a carry held to Z (Alt-drag)", () => {
  /** Looking level from the front through the orthographic lens, at 2×: up the screen is up. */
  const front: CanvasView = { ...top, pitch: Math.PI / 2, zoom: 2 };

  test("a drag up raises the carried cards with the pointer, by grid steps", () => {
    const ctx = context(doc, selectNode(moving.id), front);
    const started = reduce(
      createPointerState(),
      { type: "move/start", id: moving.id, screen: { x: 0, y: 100 }, along: ALONG_Z },
      ctx,
    );
    const still = reduce(
      started.state,
      { type: "pointer/move", screen: { x: 0, y: 98 }, shiftKey: false },
      ctx,
    );
    // Inside the slop nothing moves.
    expect(still.doc).toBeUndefined();
    const lifted = reduce(
      started.state,
      { type: "pointer/move", screen: { x: 0, y: 40 }, shiftKey: false },
      ctx,
    );
    expect(lifted.doc?.nodes.find((n) => n.id === moving.id)?.z).toBe(40);
    expect(lifted.persist).toBe("silent");
    const released = reduce(
      lifted.state,
      { type: "pointer/end", screen: { x: 0, y: 100 } },
      context(lifted.doc, selectNode(moving.id), front),
    );
    // Back where it started, the card carries no elevation at all.
    expect(released.doc?.nodes.find((n) => n.id === moving.id)).not.toHaveProperty("z");
    expect(released.persist).toBe("history");
  });

  test("from the top, where Z points at the eye, it follows the pointer up the screen (⌘: exactly)", () => {
    const zoomed = { ...top, zoom: 2 };
    const ctx = context(doc, selectNode(moving.id), zoomed);
    const started = reduce(
      createPointerState(),
      { type: "move/start", id: moving.id, screen: { x: 0, y: 100 }, along: ALONG_Z },
      ctx,
    );
    const lifted = reduce(
      started.state,
      { type: "pointer/move", screen: { x: 0, y: 40 }, shiftKey: false, free: true },
      ctx,
    );
    expect(lifted.doc?.nodes.find((n) => n.id === moving.id)?.z).toBe(30);
  });

  test("it snaps to the height another card stands at", () => {
    const shelf = { ...guide, z: 40 };
    const ctx = context({ nodes: [moving, shelf], edges: [] }, selectNode(moving.id), {
      ...front,
      zoom: 1,
    });
    const started = reduce(
      createPointerState(),
      { type: "move/start", id: moving.id, screen: { x: 0, y: 100 }, along: ALONG_Z },
      ctx,
    );
    const lifted = reduce(
      started.state,
      { type: "pointer/move", screen: { x: 0, y: 63 }, shiftKey: false },
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
      { type: "move/start", id: moving.id, screen: { x: 0, y: 0 } },
      ctx,
    );
    const over = reduce(
      started.state,
      { type: "pointer/move", screen: { x: 310, y: 310 }, shiftKey: false },
      ctx,
    );
    const stacked = over.doc?.nodes.find((n) => n.id === moving.id);
    expect(stacked?.z).toBe(70);
    expect(over.state.snapGuides).toContainEqual({ axis: "z", pos: 70 });
    const released = reduce(
      over.state,
      { type: "pointer/end", screen: { x: 310, y: 310 } },
      context(over.doc),
    );
    expect(released.doc?.nodes.find((n) => n.id === moving.id)?.z).toBe(70);
    expect(released.persist).toBe("history");

    // Picked up again and carried off: back on the floor, with no elevation written.
    const onTop = released.doc ?? doc;
    const again = reduce(
      createPointerState(),
      { type: "move/start", id: moving.id, screen: { x: 310, y: 310 } },
      context(onTop),
    );
    const off = reduce(
      again.state,
      { type: "pointer/move", screen: { x: -390, y: 310 }, shiftKey: false },
      context(onTop),
    );
    expect(off.doc?.nodes.find((n) => n.id === moving.id)).not.toHaveProperty("z");
  });
});

describe("a carry seen in depth", () => {
  const size3 = { width: 800, height: 600 };
  const tilted: CanvasView = { x: 200, y: 100, z: 0, zoom: 1, yaw: -0.3, pitch: 0.5, fov: 34 };
  const card: CanvasNode = {
    id: "c",
    type: "text",
    text: "",
    x: 100,
    y: 50,
    width: 200,
    height: 100,
    z: 40,
  };
  const on = (view: CanvasView, p: { x: number; y: number; z: number }) => {
    const at = projectPoint(view, size3, p);
    if (at === null) throw new Error("out of view");
    return { x: at.x, y: at.y };
  };
  const ctxOf = (nodes: CanvasNode[], view: CanvasView = tilted): PointerContext => ({
    ...context({ nodes, edges: [] }, selectNode(card.id), view),
    size: size3,
  });

  test("it is read on the card's own plane", () => {
    const ctx = ctxOf([card]);
    const from = on(tilted, { x: 200, y: 100, z: 40 });
    const started = reduce(
      createPointerState(),
      { type: "move/start", id: card.id, screen: from },
      ctx,
    );
    const to = on(tilted, { x: 260, y: 130, z: 40 });
    const moved = reduce(started.state, { type: "pointer/move", screen: to, shiftKey: false }, ctx);
    const shown = moved.doc?.nodes.find((n) => n.id === card.id);
    expect(shown?.x).toBeCloseTo(160, 3);
    expect(shown?.y).toBeCloseTo(80, 3);
    expect(shown?.z).toBe(40);
  });

  test("carried over a solid, the pointer is read on the solid's top, where it visibly is", () => {
    const block: CanvasNode = {
      id: "b",
      type: "shape",
      shape: "rect",
      x: 500,
      y: 40,
      width: 120,
      height: 120,
      depth: 90,
    };
    const ctx = ctxOf([card, block]);
    const from = on(tilted, { x: 200, y: 100, z: 40 });
    const started = reduce(
      createPointerState(),
      { type: "move/start", id: card.id, screen: from },
      ctx,
    );
    const over = on(tilted, { x: 560, y: 100, z: 90 });
    const moved = reduce(
      started.state,
      { type: "pointer/move", screen: over, shiftKey: false },
      ctx,
    );
    const shown = moved.doc?.nodes.find((n) => n.id === card.id);
    // Its centre came over (560, 100) and it stands on the block.
    expect((shown?.x ?? 0) + card.width / 2).toBeCloseTo(560, 3);
    expect((shown?.y ?? 0) + card.height / 2).toBeCloseTo(100, 3);
    expect(shown?.z).toBe(90);
  });

  test("a release where the card's plane is edge-on leaves it where the drag last had it", () => {
    const from = on(tilted, { x: 200, y: 100, z: 40 });
    const started = reduce(
      createPointerState(),
      { type: "move/start", id: card.id, screen: from },
      ctxOf([card]),
    );
    const moved = reduce(
      started.state,
      { type: "pointer/move", screen: { x: from.x + 20, y: from.y }, shiftKey: false },
      ctxOf([card]),
    );
    const shown = moved.doc?.nodes.find((n) => n.id === card.id);
    // The canvas turns edge-on, and the pointer is let go where its ray never meets the plane.
    const level = { ...tilted, pitch: Math.PI / 2 };
    const released = reduce(
      moved.state,
      { type: "pointer/end", screen: { x: from.x + 20, y: size3.height - 5 } },
      ctxOf(moved.doc?.nodes ?? [card], level),
    );
    expect(released.persist).toBe("history");
    expect(released.doc?.nodes.find((n) => n.id === card.id)?.x).toBe(shown?.x);
    expect(shown?.x).not.toBe(card.x);
  });
});

describe("turning", () => {
  /** A press on `moving`'s rotate handle, above its centre (50, 30), then a drag to `at`. */
  function turnTo(at: { x: number; y: number }, free = false) {
    const started = reduce(createPointerState(), {
      type: "turn/start",
      id: moving.id,
      screen: { x: 50, y: -10 },
    });
    return reduce(started.state, { type: "pointer/move", screen: at, shiftKey: false, free });
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
    const released = reduce(turned.state, { type: "pointer/end", screen: at }, context(turned.doc));
    expect(released.persist).toBe("history");
    expect(released.doc?.nodes.find((n) => n.id === moving.id)?.rotation).toEqual({ z: 45 });
  });

  test("holding ⌘ turns it freely", () => {
    const swing = (47 * Math.PI) / 180;
    const turned = turnTo({ x: 50 + 40 * Math.sin(swing), y: 30 - 40 * Math.cos(swing) }, true);
    const z = turned.doc?.nodes.find((n) => n.id === moving.id)?.rotation?.z ?? 0;
    expect(z).toBeCloseTo(47, 3);
  });

  test("a handle that reports whole transforms is previewed, snapped and written the same way", () => {
    const started = reduce(createPointerState(), { type: "transform/start" });
    const transform = {
      pivot: { x: 50, y: 30, z: 0 },
      axes: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      move: { x: 0, y: 0, z: 25 },
      turn: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      stretch: { x: 1, y: 1, z: 1 },
      extrude: 0,
    } as const;
    // Its move steps by the grid; with ⌘ held, it goes exactly where the handle has it.
    const free = reduce(started.state, { type: "transform/move", transform, free: true });
    expect(free.doc?.nodes.find((n) => n.id === moving.id)?.z).toBe(25);
    const lifted = reduce(started.state, { type: "transform/move", transform });
    expect(lifted.persist).toBe("silent");
    expect(lifted.doc?.nodes.find((n) => n.id === moving.id)?.z).toBe(20);
    const released = reduce(
      lifted.state,
      { type: "pointer/end", screen: { x: 0, y: 0 } },
      context(lifted.doc),
    );
    expect(released.persist).toBe("history");
    expect(released.doc?.nodes.find((n) => n.id === moving.id)?.z).toBe(20);
  });

  test("a turned item resizes along its own sides, its far corner held", () => {
    const spun: CanvasNode = { ...moving, rotation: { z: 90 } };
    const ctx = context({ nodes: [spun], edges: [] });
    // Turned a quarter, its own width runs down the page: dragging its east handle down widens it.
    const started = reduce(
      createPointerState(),
      { type: "resize/start", id: spun.id, corner: "se", screen: { x: 0, y: 0 } },
      ctx,
    );
    const grown = reduce(
      started.state,
      { type: "pointer/move", screen: { x: 0, y: 40 }, shiftKey: false },
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
    });
    // 3 units shy of lining up with `guide`'s left edge (200).
    const near = { x: 97, y: 0 };
    const snapped = reduce(started.state, { type: "pointer/move", screen: near, shiftKey: false });
    expect(snapped.doc?.nodes.find((n) => n.id === moving.id)?.x).toBe(100);
    const free = reduce(started.state, {
      type: "pointer/move",
      screen: near,
      shiftKey: false,
      free: true,
    });
    expect(free.doc?.nodes.find((n) => n.id === moving.id)?.x).toBe(97);
  });
});

/** The modal key a key stands for: an axis, a mode, or a typed character. */
function keyOf(k: string): TransformKey {
  if (k === "x" || k === "y" || k === "z") return { kind: "axis", axis: k, plane: false };
  if (k === "r" || k === "g" || k === "s") {
    return { kind: "mode", mode: ({ r: "rotate", g: "grab", s: "scale" } as const)[k] };
  }
  return { kind: "type", key: k };
}

describe("modal transforms (G, S, E from the keyboard)", () => {
  /** `moving` alone, away from `guide`'s alignments, grabbed with the pointer at (500, 500). */
  const alone: CanvasDoc = { nodes: [moving], edges: [] };
  const ctx = () => context(alone);
  const begin = (mode: "grab" | "scale" | "extrude", at = { x: 500, y: 500 }) =>
    reduce(createPointerState(), { type: "transform/begin", mode, screen: at }, ctx());
  const shown = (r: { doc?: CanvasDoc }) => r.doc?.nodes.find((n) => n.id === moving.id);
  const hover = (state: PointerState, at: { x: number; y: number }, free = false) =>
    reduce(state, { type: "pointer/move", screen: at, shiftKey: false, free }, ctx());
  const key = (state: PointerState, k: string) =>
    reduce(state, { type: "transform/key", key: keyOf(k) }, ctx());

  test("G follows the pointer with no button held, and a release does not end it", () => {
    const moved = hover(begin("grab").state, { x: 537, y: 512 });
    expect([shown(moved)?.x, shown(moved)?.y]).toEqual([37, 12]);
    const released = reduce(
      moved.state,
      { type: "pointer/end", screen: { x: 537, y: 512 } },
      ctx(),
    );
    expect(released.state.drag?.kind).toBe("transform");
    expect(released.doc).toBeUndefined();
  });

  test("a confirm writes it as one history step; a cancel writes nothing", () => {
    const moved = hover(begin("grab").state, { x: 537, y: 512 });
    const confirmed = reduce(moved.state, { type: "transform/confirm" }, context(moved.doc));
    expect(confirmed.persist).toBe("history");
    expect(shown(confirmed)?.x).toBe(37);
    expect(confirmed.state.drag).toBeNull();
    const cancelled = reduce(moved.state, { type: "pointer/cancel" }, context(moved.doc));
    expect(cancelled.persist).toBe("cancel");
    expect(cancelled.doc).toBeUndefined();
  });

  test("X holds it to the x axis, and it steps by the grid there; ⌘ lets it go exactly", () => {
    const held = key(begin("grab").state, "x");
    const moved = hover(held.state, { x: 537, y: 560 });
    expect([shown(moved)?.x, shown(moved)?.y]).toEqual([40, 0]);
    expect([shown(hover(held.state, { x: 537, y: 560 }, true))?.x]).toEqual([37]);
  });

  test("X twice holds it to the lead item's own x; a third time lets go", () => {
    const spun = { ...moving, rotation: { z: 90 } };
    const turned = context({ nodes: [spun], edges: [] });
    const begun = reduce(
      createPointerState(),
      { type: "transform/begin", mode: "grab", screen: { x: 500, y: 500 } },
      turned,
    );
    const once = reduce(begun.state, { type: "transform/key", key: keyOf("x") }, turned);
    const twice = reduce(once.state, { type: "transform/key", key: keyOf("x") }, turned);
    // Its own x runs down the page: a drag down the page carries it there.
    const down = reduce(
      twice.state,
      { type: "pointer/move", screen: { x: 500, y: 540 }, shiftKey: false },
      turned,
    );
    const item = down.doc?.nodes.find((n) => n.id === spun.id);
    expect(item?.x).toBeCloseTo(0, 6);
    expect(item?.y).toBeCloseTo(40, 6);
    const thrice = reduce(twice.state, { type: "transform/key", key: keyOf("x") }, turned);
    expect(thrice.state.drag?.kind === "transform" && thrice.state.drag.input?.constraint).toBe(
      null,
    );
  });

  test("a typed value sets it exactly along the constraint, and - negates", () => {
    let state = key(begin("grab").state, "y").state;
    for (const k of ["1", "2", ".", "5", "-"]) state = key(state, k).state;
    const typed = key(state, "Backspace");
    // "-12.5" less its last character: -12.
    expect([shown(typed)?.x, shown(typed)?.y]).toEqual([0, -12]);
  });

  test("R inside a modal turns, about the axis toward the eye; typed in degrees", () => {
    let state = key(begin("grab").state, "r").state;
    for (const k of ["3", "0"]) state = key(state, k).state;
    const turned = reduce(state, { type: "transform/confirm" }, ctx());
    expect(shown(turned)?.rotation).toEqual({ z: 30 });
  });

  test("S scales about the pivot by the pointer's reach from it, landing on grid multiples", () => {
    // The pivot (50, 30) is on screen at (50, 30): from 100 away to 137 away is ×1.37.
    const scaled = hover(begin("scale", { x: 150, y: 30 }).state, { x: 187, y: 30 });
    expect(shown(scaled)?.width).toBe(140);
  });

  test("E extrudes up the screen from the top view, by the grid; typed, exactly", () => {
    const grown = hover(begin("extrude").state, { x: 500, y: 455 });
    expect(shown(grown)?.depth).toBe(40);
    let state = begin("extrude").state;
    for (const k of ["3", "3"]) state = key(state, k).state;
    expect(shown(reduce(state, { type: "transform/confirm" }, ctx()))?.depth).toBe(33);
  });

  test("a press ends it: a plain left press confirms; the right button or a Ctrl-click cancels", () => {
    const moved = hover(begin("grab").state, { x: 537, y: 512 });
    const pressWith = (button: number, ctrlKey: boolean) =>
      reduce(moved.state, { type: "transform/press", button, ctrlKey }, context(moved.doc));
    const confirmed = pressWith(0, false);
    expect(confirmed.persist).toBe("history");
    expect(shown(confirmed)?.x).toBe(37);
    for (const [button, ctrl] of [
      [2, false],
      [1, false],
      [0, true],
    ] as const) {
      const cancelled = pressWith(button, ctrl);
      expect(cancelled.persist).toBe("cancel");
      expect(cancelled.doc).toBeUndefined();
      expect(cancelled.state.drag).toBeNull();
    }
  });

  test("a press with no modal transform under way means nothing here", () => {
    const state = createPointerState();
    const pressed = reduce(state, { type: "transform/press", button: 0, ctrlKey: false });
    expect(pressed.state).toBe(state);
  });

  test("switching mode where the pointer cannot be read sets the last mode aside", () => {
    const moved = hover(begin("grab").state, { x: 537, y: 512 });
    // Level from the front, standing past the pivot: the pivot is behind the eye.
    const behind = context(alone, selectNode(moving.id), {
      ...top,
      y: -10_000,
      pitch: Math.PI / 2,
      fov: 34,
    });
    const switched = reduce(moved.state, { type: "transform/key", key: keyOf("r") }, behind);
    expect(shown(switched)?.x).toBe(0);
    expect(switched.state.drag?.kind === "transform" && switched.state.drag.applied).toBeNull();
    const confirmed = reduce(switched.state, { type: "transform/confirm" }, behind);
    expect(confirmed.doc).toBeUndefined();
  });

  test("with nothing selected, G begins nothing", () => {
    const none = reduce(
      createPointerState(),
      { type: "transform/begin", mode: "grab", screen: { x: 0, y: 0 } },
      context(alone, EMPTY_SELECTION),
    );
    expect(none.state.drag).toBeNull();
  });
});
