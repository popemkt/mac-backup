import { describe, expect, test, vi } from "vitest";
import type { CanvasNode } from "@kb/canvas";
import { projectPoint, type CanvasView } from "@/lib/canvas-camera";
import type { CanvasPointerEvent } from "@/lib/canvas-pointer";
import { SceneGestures, type SceneGestureHost, type ScenePress } from "./canvas-scene-gestures";

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

function harness(view: () => CanvasView = () => tilted) {
  const events: CanvasPointerEvent[] = [];
  const host: SceneGestureHost = {
    view,
    size: () => size,
    items: () => [card],
    spaceDown: () => false,
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
  test("a drag on a card carries it across its own plane", () => {
    const { gestures, events } = harness();
    const at = centre();
    expect(gestures.down(press(at))).toBe(true);
    gestures.move(press({ x: at.x + 30, y: at.y }));
    gestures.up(press({ x: at.x + 30, y: at.y }), false);
    expect(events.map((e) => e.type)).toEqual(["move/start", "pointer/move", "pointer/end"]);
    const start = events[0];
    // The press lands on the card's plane, at its centre.
    expect(start?.type === "move/start" && start.world.x).toBeCloseTo(200, 6);
    expect(start?.type === "move/start" && start.world.y).toBeCloseTo(100, 6);
  });

  test("with Alt, the drag carries it along depth", () => {
    const { gestures, events } = harness();
    gestures.down(press(centre(), { altKey: true }));
    expect(events[0]?.type).toBe("lift/start");
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

  test("a release where the card's plane is edge-on leaves the card where the drag last had it", () => {
    let view = tilted;
    const { gestures, events } = harness(() => view);
    const at = centre();
    gestures.down(press(at));
    gestures.move(press({ x: at.x + 20, y: at.y }));
    const moved = events.at(-1);
    // The canvas turns edge-on, and the pointer is let go where its ray never meets the plane.
    view = { ...tilted, pitch: Math.PI / 2 };
    gestures.up(press({ x: at.x + 20, y: size.height - 5 }), false);
    const end = events.at(-1);
    expect(end?.type).toBe("pointer/end");
    expect(moved?.type).toBe("pointer/move");
    if (end?.type !== "pointer/end" || moved?.type !== "pointer/move") return;
    expect(end.world).toEqual(moved.world);
    expect(end.world.x).not.toBe(0);
  });

  test("a pan that never moved does not settle the camera", () => {
    const { gestures, host } = harness();
    gestures.down(press({ x: 5, y: 5 }, { button: 2 }));
    gestures.up(press({ x: 5, y: 5 }, { button: 2 }), false);
    expect(host.settled).not.toHaveBeenCalled();
    expect(host.tapEmpty).not.toHaveBeenCalled();
  });
});
