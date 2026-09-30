/**
 * The canvas projection contract (DESIGN-UI.md → Canvas → Projections): what
 * every projection in `CANVAS_PROJECTIONS` promises about one document, proved
 * over each of them with the view that projection holds.
 *
 * - it draws every item once, back to front in paint order;
 * - it draws every edge whose two ends exist, and no other;
 * - it marks exactly the shared selection;
 * - an item's centre is drawn where the one camera model projects it;
 * - what the renderer itself finds under an item's centre — the DOM's topmost
 *   box, three's own ray — is what the model's `hitTest` says, raised and
 *   overlapping cards included;
 * - a card moved in the document is drawn where it moved.
 *
 * The 2D projection is the real DOM stage; the 3D one is the real scene on
 * the GPU stand-ins (`@/test-support/fake-gpu`). A projection joins by its
 * registration: the table below must list exactly the registry.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { paintOrder, type CanvasDoc, type CanvasNode, type CanvasProjectionKind } from "@kb/canvas";
import {
  hitTest,
  panOfView,
  projectPoint,
  type CanvasView,
  type ViewSize,
} from "@/lib/canvas-camera";
import { CanvasCameraRig } from "@/lib/canvas-camera-rig";
import type { CanvasSelection } from "@/lib/canvas-selection";
import { TIMING_FALLBACK } from "@/lib/timing";
import { fakeCanvasContexts } from "@/test-support/fake-gpu";
import type { CardLook } from "./canvas-card-face";
import { CANVAS_PROJECTIONS, canvasProjection } from "./canvas-projections";
import type * as ThreeWebGpu from "three/webgpu";

vi.mock("three/webgpu", async (importOriginal) => ({
  ...(await importOriginal<typeof ThreeWebGpu>()),
  ...(await import("@/test-support/fake-gpu")).FAKE_WEBGPU,
}));

const doc: CanvasDoc = {
  nodes: [
    { id: "frame", type: "group", label: "Frame", x: -40, y: -40, width: 720, height: 260 },
    { id: "low", type: "text", text: "on the plane", x: 0, y: 0, width: 200, height: 100 },
    { id: "raised", type: "text", text: "raised", x: 150, y: 40, width: 200, height: 100, z: 80 },
    {
      id: "sunk",
      type: "shape",
      shape: "rect",
      label: "sunk",
      x: 450,
      y: 0,
      width: 160,
      height: 90,
      z: -30,
    },
    { id: "gone", type: "kb-node", nodeId: "no.such.node", x: 700, y: 150, width: 180, height: 60 },
  ],
  edges: [
    { id: "e1", fromNode: "low", toNode: "raised", toEnd: "arrow" },
    { id: "e2", fromNode: "raised", toNode: "sunk", fromSide: "right", toSide: "top" },
    { id: "dangling", fromNode: "low", toNode: "nowhere" },
  ],
};
const selection: CanvasSelection = { nodeIds: new Set(["raised"]), edgeIds: new Set(["e2"]) };
const size: ViewSize = { width: 1000, height: 700 };
/** The one view each projection is handed, and holds its own way. */
const asked: CanvasView = { x: 300, y: 80, z: 0, zoom: 0.8, yaw: -0.35, pitch: 0.5, fov: 34 };

const look: CardLook = {
  face: "rgb(255, 255, 255)",
  ink: "rgb(20, 20, 20)",
  primary: "rgb(190, 120, 20)",
  danger: "rgb(200, 30, 30)",
  presets: { "1": "rgb(200, 40, 40)" },
  font: "sans-serif",
  body: 14.5,
  ui: 13,
  label: 11,
  radius: 18,
  shapeRadius: 8,
};

interface Probe {
  /** Item ids drawn, back to front. */
  drawn(): string[];
  edges(): string[];
  selected(): string[];
  screenOf(id: string): { x: number; y: number } | null;
  /** The item the renderer itself finds at a screen point. */
  hit(point: { x: number; y: number }): string | null;
  update(next: CanvasDoc): Promise<void>;
  dispose(): void;
}

type Mount = (view: CanvasView) => Promise<Probe>;

const noop = () => {};
const px = (v: string) => Number.parseFloat(v);

/** The DOM stage, and the box each card is laid out in under its CSS transform. */
const mount2d: Mount = async (view) => {
  const { CanvasStage } = await import("./canvas-stage");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const { pan, zoom } = panOfView(view, size);
  const render = (current: CanvasDoc) =>
    act(() =>
      root.render(
        createElement(CanvasStage, {
          doc: current,
          nodes: new Map(),
          byId: new Map(current.nodes.map((n) => [n.id, n])),
          selection,
          pan,
          zoom,
          spaceDown: false,
          toolState: { tool: "select" },
          editingEdgeLabel: null,
          edgeDrag: null,
          snapGuides: [],
          marqueeRect: null,
          onEditingEdgeLabelChange: noop,
          onEdgeLabelCommit: noop,
          onCardSelect: noop,
          onCardChange: noop,
          onResizeStart: noop,
          onPortDown: noop,
          onWheel: noop,
          onPointerDownStage: noop,
          onPointerMove: noop,
          onPointerCancel: noop,
          onPointerUp: noop,
          onDoubleClickStage: noop,
          handleCardPointerDown: noop,
          handleEdgeClick: noop,
        }),
      ),
    );
  render(doc);
  const cards = () => [...container.querySelectorAll<HTMLElement>("[data-card-id]")];
  const box = (el: HTMLElement) => {
    const laid = el.style.left === "" ? el.querySelector<HTMLElement>("[style*='left']") : el;
    if (laid === null) return null;
    const x = px(laid.style.left) * zoom + pan.x;
    const y = px(laid.style.top) * zoom + pan.y;
    return { x, y, w: px(laid.style.width) * zoom, h: px(laid.style.height) * zoom };
  };
  return {
    drawn: () => cards().map((el) => el.dataset.cardId ?? ""),
    edges: () =>
      [...container.querySelectorAll<SVGElement>("[data-edge-id]")].map(
        (el) => el.dataset.edgeId ?? "",
      ),
    selected: () =>
      [...container.querySelectorAll<HTMLElement>("[data-selected]")].map(
        (el) => el.dataset.cardId ?? el.dataset.edgeId ?? "",
      ),
    screenOf: (id) => {
      const el = cards().find((c) => c.dataset.cardId === id);
      const b = el === undefined ? null : box(el);
      return b === null ? null : { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    },
    // Positioned siblings in one stacking context: the last one laid out over the point is on top.
    hit: (p) =>
      cards().findLast((el) => {
        const b = box(el);
        return b !== null && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
      })?.dataset.cardId ?? null,
    update: async (next) => {
      render(next);
      await Promise.resolve();
    },
    dispose: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

/** The scene on the GPU stand-ins, read back through its inspection. */
const mount3d: Mount = async (view) => {
  const { mountCanvasScene } = await import("./canvas-scene");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const rig = new CanvasCameraRig(view, TIMING_FALLBACK, true);
  const scene = await mountCanvasScene(host, {
    rig,
    content: { doc, nodes: new Map(), selection },
    look,
    palette: {
      ground: "rgb(255, 255, 255)",
      edge: "rgb(255, 255, 255)",
      hue: "rgb(120, 120, 120)",
      ink: "rgb(20, 20, 20)",
      accent: "rgb(190, 120, 20)",
    },
    dark: false,
    timing: TIMING_FALLBACK,
    reducedMotion: true,
  });
  scene.setRunning(true);
  scene.resize(size.width, size.height);
  const inspect = () => scene.inspect();
  return {
    drawn: () => [...inspect().items],
    edges: () => [...inspect().edges],
    selected: () => [...inspect().selected],
    screenOf: (id) => inspect().screenOf(id),
    hit: (p) => inspect().pick(p),
    update: async (next) => {
      scene.setContent({ doc: next, nodes: new Map(), selection });
      await Promise.resolve();
    },
    dispose: () => {
      scene.dispose();
      host.remove();
    },
  };
};

const PROBES: Record<CanvasProjectionKind, Mount> = { "2d": mount2d, "3d": mount3d };

const centreOf = (item: CanvasNode) => ({
  x: item.x + item.width / 2,
  y: item.y + item.height / 2,
  z: item.z ?? 0,
});

describe("canvas projection contract", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, unknown>();

  beforeAll(() => {
    const dom = new Window({ url: "https://kb.test/" });
    const globals: Record<string, unknown> = {
      window: dom,
      document: dom.document,
      HTMLElement: dom.HTMLElement,
      HTMLCanvasElement: dom.HTMLCanvasElement,
      SVGElement: dom.SVGElement,
      Node: dom.Node,
      getComputedStyle: dom.getComputedStyle.bind(dom),
      requestAnimationFrame: (run: (now: number) => void) => {
        run(0);
        return 0;
      },
      cancelAnimationFrame: noop,
      IS_REACT_ACT_ENVIRONMENT: true,
    };
    for (const [key, value] of Object.entries(globals)) {
      saved.set(key, g[key]);
      g[key] = value;
    }
    fakeCanvasContexts(dom.HTMLCanvasElement.prototype);
  });

  afterAll(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  });

  it("proves every registered projection", () => {
    expect(Object.keys(PROBES).toSorted()).toEqual(
      CANVAS_PROJECTIONS.map((p) => p.kind).toSorted(),
    );
  });

  describe.each(CANVAS_PROJECTIONS.map((p) => [p.kind] as const))("%s", (kind) => {
    const view = canvasProjection(kind).settle(asked);
    const mount = PROBES[kind];

    it("draws every item once, back to front", async () => {
      const probe = await mount(view);
      expect(probe.drawn()).toEqual(paintOrder(doc.nodes).map((n) => n.id));
      probe.dispose();
    });

    it("draws every edge whose two ends exist, and no other", async () => {
      const probe = await mount(view);
      expect(probe.edges().toSorted()).toEqual(["e1", "e2"]);
      probe.dispose();
    });

    it("marks exactly the selection", async () => {
      const probe = await mount(view);
      expect(probe.selected().toSorted()).toEqual(["e2", "raised"]);
      probe.dispose();
    });

    it("draws each item's centre where the camera model projects it", async () => {
      const probe = await mount(view);
      for (const item of doc.nodes) {
        const model = projectPoint(view, size, centreOf(item));
        const drawn = probe.screenOf(item.id);
        expect(drawn, item.id).not.toBeNull();
        expect(drawn?.x, item.id).toBeCloseTo(model?.x ?? Number.NaN, 1);
        expect(drawn?.y, item.id).toBeCloseTo(model?.y ?? Number.NaN, 1);
      }
      probe.dispose();
    });

    it("finds under each item's centre what the model's hit test finds", async () => {
      const probe = await mount(view);
      const order = paintOrder(doc.nodes);
      for (const item of doc.nodes) {
        const at = projectPoint(view, size, centreOf(item));
        if (at === null) continue;
        expect(probe.hit(at), item.id).toBe(hitTest(order, view, size, at));
      }
      // The raised card covers the one beneath it where they overlap.
      const overlap = projectPoint(view, size, { x: 175, y: 70, z: 80 });
      expect(overlap && probe.hit(overlap)).toBe("raised");
      probe.dispose();
    });

    it("draws a moved card where it moved", async () => {
      const probe = await mount(view);
      const moved = doc.nodes.map((n) => (n.id === "sunk" ? { ...n, x: n.x + 120, z: 40 } : n));
      await probe.update({ ...doc, nodes: moved });
      const item = moved.find((n) => n.id === "sunk");
      const model = item === undefined ? null : projectPoint(view, size, centreOf(item));
      expect(probe.screenOf("sunk")?.x).toBeCloseTo(model?.x ?? Number.NaN, 1);
      expect(probe.screenOf("sunk")?.y).toBeCloseTo(model?.y ?? Number.NaN, 1);
      probe.dispose();
    });
  });
});
