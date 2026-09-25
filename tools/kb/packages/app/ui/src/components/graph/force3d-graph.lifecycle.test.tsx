/**
 * The 3D host's life cycle: whatever takes it off screen — a renderer
 * switch, a new perspective, leaving the page — leaves no live scene behind
 * (and so no renderer, worker or listener), including a scene whose mount
 * was still in flight when the host went away.
 *
 * The scene is a stand-in: happy-dom has no GPU, and what is under test is
 * the host's hand-off, not three.js.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LensNode } from "@/lib/graph-lens";
import type { GraphCameraControls } from "./graph-camera-controls";
import type { Force3dScene, Force3dSceneInit } from "./force3d-scene";

const scenes = vi.hoisted(() => ({
  mounted: 0,
  disposed: 0,
  emphasis: [] as unknown[],
  hold: null as Promise<void> | null,
  noop: () => {},
}));

vi.mock("./force3d-scene", () => ({
  mountForce3d: async (_host: HTMLElement, _init: Force3dSceneInit): Promise<Force3dScene> => {
    scenes.mounted += 1;
    if (scenes.hold) await scenes.hold;
    const { noop } = scenes;
    const controls: GraphCameraControls = {
      fit: noop,
      zoomIn: noop,
      zoomOut: noop,
      reset: noop,
      focusNode: noop,
    };
    return {
      backend: "WebGL2",
      controls,
      setGraph: noop,
      setSettings: noop,
      setEmphasis: (e) => scenes.emphasis.push(e.selectedNodeId),
      setPalette: noop,
      setReducedMotion: noop,
      resize: noop,
      setRunning: noop,
      inspect: () => {
        throw new Error("not in this test");
      },
      dispose: () => {
        scenes.disposed += 1;
      },
    };
  },
}));

const { default: Force3dGraph } = await import("./force3d-graph");

const nodes: LensNode[] = [
  { id: "a", label: "a", color: "#888", size: 3, clusterKey: "r", tags: [], degree: 1 },
];

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await act(async () => Promise.resolve());
}

const live = () => scenes.mounted - scenes.disposed;

describe("Force3dGraph life cycle", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.IS_REACT_ACT_ENVIRONMENT = true;
    g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    g.getComputedStyle = dom.getComputedStyle.bind(dom);
    g.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
  });

  beforeEach(() => {
    scenes.mounted = 0;
    scenes.disposed = 0;
    scenes.emphasis = [];
    scenes.hold = null;
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  const host3d = (layoutKey: string, selectedNodeId: string | null = null) =>
    createElement(Force3dGraph, {
      nodes,
      edges: [],
      layoutKey,
      appearanceKey: "kb:dark",
      selectedNodeId,
    });

  it("disposes its scene on a renderer switch, and on unmount", async () => {
    await act(async () => root.render(host3d("p1")));
    await settle();
    expect(scenes.mounted).toBe(1);
    expect(live()).toBe(1);
    // Another renderer takes the frame: the 3D host unmounts.
    await act(async () => root.render(createElement("div", { "data-testid": "sigma-graph" })));
    expect(live()).toBe(0);
    await act(async () => root.render(host3d("p1")));
    await settle();
    expect(live()).toBe(1);
    act(() => root.unmount());
    expect(live()).toBe(0);
  });

  it("gives the old scene back when the perspective changes", async () => {
    await act(async () => root.render(host3d("p1")));
    await settle();
    await act(async () => root.render(host3d("p2")));
    await settle();
    expect(scenes.mounted).toBe(2);
    expect(live()).toBe(1);
    act(() => root.unmount());
    expect(live()).toBe(0);
  });

  it("disposes a scene that finishes mounting after the host has gone", async () => {
    let release = scenes.noop;
    scenes.hold = new Promise((resolve) => {
      release = resolve;
    });
    await act(async () => root.render(host3d("p1")));
    act(() => root.unmount());
    release();
    await settle();
    expect(scenes.mounted).toBe(1);
    expect(live()).toBe(0);
  });

  it("hands a new selection to the scene", async () => {
    await act(async () => root.render(host3d("p1")));
    await settle();
    await act(async () => root.render(host3d("p1", "a")));
    await settle();
    expect(scenes.emphasis.at(-1)).toBe("a");
    act(() => root.unmount());
  });
});
