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
) {
  const events: CanvasPointerEvent[] = [];
  const host: SceneGestureHost = {
    view,
    size: () => size,
    items: () => items,
    selection: () => ({ nodeIds: new Set(), edgeIds: new Set() }),
    spaceDown: () => false,
    gizmo: () => gizmo,
    cardPress: (_card, _press, startMove) => startMove(),
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

  test("a pan that never moved does not settle the camera", () => {
    const { gestures, host } = harness();
    gestures.down(press({ x: 5, y: 5 }, { button: 2 }));
    gestures.up(press({ x: 5, y: 5 }, { button: 2 }), false);
    expect(host.settled).not.toHaveBeenCalled();
    expect(host.tapEmpty).not.toHaveBeenCalled();
  });
});
