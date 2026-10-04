/**
 * A capture holds the canvas's 3D scene mounted while it draws, waits for a
 * scene it had to start, answers with the picture as base64 PNG, and lets
 * the scene go however the drawing ends.
 */
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CanvasView } from "./canvas-camera";
import { useCanvasCapture, type CanvasPainter } from "./canvas-capture";

const view: CanvasView = { x: 0, y: 0, z: 0, zoom: 1, yaw: 0, pitch: 0, fov: 0 };

let root: Root;
let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: "https://kb.test/" });
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    HTMLElement: win.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** The hook as a page holds it, its hold counted. */
function mount() {
  const held = { now: 0, most: 0 };
  const hold = () => {
    held.now += 1;
    held.most = Math.max(held.most, held.now);
    return () => {
      held.now -= 1;
    };
  };
  const hook: { api?: ReturnType<typeof useCanvasCapture> } = {};
  function Host() {
    const api = useCanvasCapture(hold);
    useEffect(() => {
      hook.api = api;
    });
    return null;
  }
  act(() => root.render(createElement(Host)));
  const { api } = hook;
  if (api === undefined) throw new Error("no hook");
  return { api, held };
}

const painter = (bytes: number[]): CanvasPainter => ({
  picture: () => Promise.resolve({ png: new Blob([new Uint8Array(bytes)]), width: 2, height: 1 }),
});

describe("a canvas capture", () => {
  it("waits for the scene it started, answers with its picture, and lets the scene go", async () => {
    const { api, held } = mount();
    const answer = api.capture(view);
    expect(held.now).toBe(1);
    api.onPainter(painter([137, 80, 78, 71]));
    expect(await answer).toEqual({
      outcome: "applied",
      picture: { mime: "image/png", data: "iVBORw==", width: 2, height: 1 },
    });
    expect(held).toEqual({ now: 0, most: 1 });
  });

  it("a scene that draws nothing is said so, and the scene is let go all the same", async () => {
    const { api, held } = mount();
    api.onPainter({ picture: () => Promise.resolve(null) });
    expect(await api.capture(view)).toEqual({
      outcome: "rejected",
      reason: "the canvas drew no picture",
    });
    expect(held.now).toBe(0);
  });
});
