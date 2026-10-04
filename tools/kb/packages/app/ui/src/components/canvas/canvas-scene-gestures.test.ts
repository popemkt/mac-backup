import { describe, expect, test, vi } from "vitest";
import type { CanvasNode } from "@kb/canvas";
import { projectPoint, type CanvasView } from "./canvas-camera";
import type { CanvasPointerEvent } from "./canvas-pointer";
import { ALONG_Z } from "./canvas-transform-input";
import { SceneGestures, type SceneGestureHost, type ScenePress } from "./canvas-scene-gestures";
import { NO_GIZMO, type SceneGizmo } from "./canvas-gizmo";

const size = { width: 800, height: 600 };
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

function harness(
  view: () => CanvasView = () => tilted,
  items: readonly CanvasNode[] = [card],
  gizmo: SceneGizmo = NO_GIZMO,
  transforming = false,
) {
  const events: CanvasPointerEvent[] = [];
  const host: SceneGestureHost = {
    view,
    size: () => size,
    items: () => items,
    selection: () => ({ nodeIds: new Set(), edgeIds: new Set() }),
    spaceDown: () => false,
    placing: () => false,
    transforming: () => transforming,
    gizmo: () => gizmo,
    cardPress: (pressed, _press, startMove) => startMove(pressed.id),
    cardDoubleClick: vi.fn(() => true),
    dispatch: (event) => events.push(event),
    orbit: vi.fn(),
    pan: vi.fn(),
    tapEmpty: vi.fn(),
    settled: vi.fn(),
  };
  return { gestures: new SceneGestures(host), events, host };
}

function press(local: { x: number; y: number }, extra: Partial<ScenePress> = {}): ScenePress {
  return {
    local,
    clientX: local.x,
    clientY: local.y,
    button: 0,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...extra,
  };
}

const centre = () => {
  const at = projectPoint(tilted, size, { x: 200, y: 100, z: 40 });
  if (at === null) throw new Error("the card's centre is out of view");
  return { x: at.x, y: at.y };
};

describe("gestures over the 3D canvas", () => {
  test("a drag on a card carries it, reported at viewport points the reducer reads", () => {
    const { gestures, events } = harness();
    const at = centre();
    expect(gestures.down(press(at))).toBe(true);
    gestures.move(press({ x: at.x + 30, y: at.y }));
    gestures.up(press({ x: at.x + 30, y: at.y }), false);
    expect(events).toEqual([
      { type: "move/start", id: card.id, screen: at },
      { type: "pointer/move", screen: { x: at.x + 30, y: at.y }, shiftKey: false, free: false },
      { type: "pointer/end", screen: { x: at.x + 30, y: at.y }, shiftKey: false, free: false },
    ]);
  });

  test("with Alt, the drag is held to Z", () => {
    const { gestures, events } = harness();
    gestures.down(press(centre(), { altKey: true }));
    expect(events[0]).toEqual({
      type: "move/start",
      id: card.id,
      screen: centre(),
      along: ALONG_Z,
    });
  });

  test("a drag on empty canvas orbits, and settles when it ends", () => {
    const { gestures, host } = harness();
    gestures.down(press({ x: 5, y: 5 }));
    gestures.move(press({ x: 45, y: 5 }));
    gestures.up(press({ x: 45, y: 5 }), false);
    expect(host.orbit).toHaveBeenCalledWith(40, 0);
    expect(host.settled).toHaveBeenCalledTimes(1);
  });

  test("a tap on empty canvas is a tap, at the canvas plane under it", () => {
    const { gestures, host } = harness();
    gestures.down(press({ x: 5, y: 5 }));
    gestures.up(press({ x: 6, y: 5 }), false);
    expect(host.tapEmpty).toHaveBeenCalledTimes(1);
    expect(host.settled).not.toHaveBeenCalled();
  });

  test("the right button pans", () => {
    const { gestures, host } = harness();
    gestures.down(press(centre(), { button: 2 }));
    gestures.move(press({ x: centre().x + 10, y: centre().y }, { button: 2 }));
    expect(host.pan).toHaveBeenCalledWith(10, 0);
  });

  test("a gizmo handle takes the press over the card behind it, and its drag is one transform", () => {
    const transform = {
      pivot: { x: 200, y: 100, z: 40 },
      axes: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const,
      move: { x: 30, y: 0, z: 0 },
      turn: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const,
      stretch: { x: 1, y: 1, z: 1 },
      extrude: 0,
    };
    const release = vi.fn();
    const gizmo: SceneGizmo = {
      hover: () => true,
      press: () => true,
      drag: () => transform,
      release,
    };
    const { gestures, events } = harness(() => tilted, [card], gizmo);
    const at = centre();
    gestures.down(press(at));
    expect(events.at(-1)).toEqual({ type: "transform/start" });
    expect(gestures.move(press({ x: at.x + 20, y: at.y }, { metaKey: true }))).toBe("grabbing");
    expect(events.at(-1)).toEqual({ type: "transform/move", transform, free: true });
    gestures.up(press({ x: at.x + 20, y: at.y }), false);
    expect(release).toHaveBeenCalled();
    expect(events.at(-1)?.type).toBe("pointer/end");
  });

  test("during a modal transform a press only ends it, reaching nothing under it", () => {
    const { gestures, events, host } = harness(() => tilted, [card], NO_GIZMO, true);
    // Over the card, with the right button and with a Ctrl-click: each is a press, told as such.
    expect(gestures.down(press(centre()))).toBe(false);
    expect(gestures.down(press(centre(), { button: 2 }))).toBe(false);
    expect(gestures.down(press(centre(), { ctrlKey: true }))).toBe(false);
    expect(events).toEqual([
      { type: "transform/press", button: 0, ctrlKey: false },
      { type: "transform/press", button: 2, ctrlKey: false },
      { type: "transform/press", button: 0, ctrlKey: true },
    ]);
    gestures.up(press(centre()), false);
    expect(host.tapEmpty).not.toHaveBeenCalled();
  });

  test("with no button held, the pointer is still told to the reducer", () => {
    const { gestures, events } = harness(() => tilted, [card], NO_GIZMO, true);
    expect(gestures.move(press({ x: 40, y: 50 }))).toBe("grabbing");
    expect(events).toEqual([
      { type: "pointer/move", screen: { x: 40, y: 50 }, shiftKey: false, free: false },
    ]);
  });

  test("a pan that never moved does not settle the camera", () => {
    const { gestures, host } = harness();
    gestures.down(press({ x: 5, y: 5 }, { button: 2 }));
    gestures.up(press({ x: 5, y: 5 }, { button: 2 }), false);
    expect(host.settled).not.toHaveBeenCalled();
    expect(host.tapEmpty).not.toHaveBeenCalled();
  });
});

describe("groups in 3D", () => {
  test("a press carries what the page says it reaches: the group a member stands for", () => {
    const { gestures, events, host } = harness();
    gestures.bind({ ...host, cardPress: (_card, _press, startMove) => startMove("its-group") });
    gestures.down(press(centre()));
    expect(events[0]).toEqual({ type: "move/start", id: "its-group", screen: centre() });
  });

  test("a double-click on a card asks to enter toward it; on empty canvas, or mid-transform, nothing", () => {
    const { gestures, host } = harness();
    gestures.doubleClick(press(centre()));
    expect(host.cardDoubleClick).toHaveBeenCalledWith(card);
    gestures.doubleClick(press({ x: 5, y: 5 }));
    expect(host.cardDoubleClick).toHaveBeenCalledTimes(1);
    const modal = harness(undefined, undefined, undefined, true);
    modal.gestures.doubleClick(press(centre()));
    expect(modal.host.cardDoubleClick).not.toHaveBeenCalled();
  });
});

describe("a placing tool over a frame", () => {
  const frame: CanvasNode = { id: "f", type: "group", x: 100, y: 50, width: 200, height: 100 };

  test("sees through it to the floor: a tap places, where a press would select the frame", () => {
    const { gestures, events, host } = harness(undefined, [frame]);
    gestures.bind({ ...host, placing: () => true });
    const at = projectPoint(tilted, size, { x: 200, y: 100, z: 0 });
    if (at === null) throw new Error("the frame's centre is out of view");
    gestures.down(press(at));
    gestures.up(press(at), false);
    expect(host.tapEmpty).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
    // With the select tool the same press takes hold of the frame.
    const plain = harness(undefined, [frame]);
    plain.gestures.down(press(at));
    expect(plain.events[0]).toMatchObject({ type: "move/start", id: "f" });
    // A frame lying on the floor: the place is on the floor.
    expect(vi.mocked(host.tapEmpty).mock.calls[0]?.[0]).toMatchObject({ face: null });
  });

  test("places on the face of a frame stood up as a wall, where the press meets it", () => {
    const wall: CanvasNode = { ...frame, z: 100, rotation: { x: -90 } };
    const level: CanvasView = { x: 200, y: 300, z: 100, zoom: 1, yaw: 0, pitch: 1.4, fov: 34 };
    const { gestures, host } = harness(() => level, [wall]);
    gestures.bind({ ...host, placing: () => true });
    const on = { x: 180, y: 100, z: 120 };
    const at = projectPoint(level, size, on);
    if (at === null) throw new Error("the wall is out of view");
    gestures.down(press(at));
    gestures.up(press(at), false);
    const place = vi.mocked(host.tapEmpty).mock.calls[0]?.[0];
    expect(place?.face).not.toBeNull();
    expect(place?.at.x).toBeCloseTo(on.x, 6);
    expect(place?.at.y).toBeCloseTo(on.y, 6);
    expect(place?.at.z).toBeCloseTo(on.z, 6);
  });
});
