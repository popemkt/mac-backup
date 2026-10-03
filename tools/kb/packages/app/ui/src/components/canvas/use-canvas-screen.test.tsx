/**
 * The canvas's part of the screen: the camera of the projection showing, in
 * the document's pose shape, and the items that camera shows — the 2D view's
 * in 2D, the 3D view's as it came to rest in 3D.
 */
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CanvasDoc } from "@kb/canvas";
import type { CanvasView } from "./canvas-camera";
import { EMPTY_SELECTION } from "./canvas-selection";
import { useScreenStore } from "@/stores/screen.store";
import { useCanvasScreen } from "./use-canvas-screen";
import { browserHostUiPlugin } from "@/browser-host";
import { syncUiPlugins } from "@/lib/plugins";

// The canvas reaches the shell through the page's host, as when the app boots.
beforeAll(() => syncUiPlugins([browserHostUiPlugin]));
afterAll(() => syncUiPlugins([]));

const doc: CanvasDoc = {
  nodes: [
    { id: "near", type: "text", text: "", x: 0, y: 0, width: 100, height: 50 },
    { id: "far", type: "text", text: "", x: 5000, y: 0, width: 100, height: 50 },
  ],
  edges: [],
};

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

function report(shown: "2d" | "3d", settled3d: CanvasView | null) {
  function Host() {
    const stage = useRef<HTMLElement>(null);
    useCanvasScreen({
      canvasId: "c",
      doc,
      pan: { x: 10, y: 20 },
      zoom: 1,
      shown,
      settled3d,
      stage,
      selection: EMPTY_SELECTION,
      setSelection: () => {},
    });
    return null;
  }
  act(() => root.render(createElement(Host)));
  return Object.values(useScreenStore.getState().panes)[0]?.report.canvas;
}

describe("the canvas screen report", () => {
  it("in 2D is the top view, orthographic", () => {
    const canvas = report("2d", null);
    expect(canvas?.projection).toBe("2d");
    expect(canvas?.pose).toMatchObject({ yaw: 0, pitch: 0, fov: 0, zoom: 1, z: 0 });
  });

  it("in 3D is the 3D camera as it came to rest, and what it shows", () => {
    const view = { x: 50, y: 25, z: 0, zoom: 1, yaw: -0.4, pitch: 0.85, fov: 34 };
    const canvas = report("3d", view);
    expect(canvas?.projection).toBe("3d");
    expect(canvas?.pose).toEqual(view);
  });
});
