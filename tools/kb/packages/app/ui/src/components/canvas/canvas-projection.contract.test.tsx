/**
 * The canvas projection contract (DESIGN-UI.md → Canvas → Projections): what
 * every projection in `CANVAS_PROJECTIONS` promises about one document, proved
 * over each of them with the view that projection holds.
 *
 * - it draws every item once, back to front in paint order;
 * - it draws every edge whose two ends exist, and no other;
 * - it marks exactly the shared selection;
 * - every item's corners are drawn where the one camera model projects them
 *   on the item's paint plane (`paintPlanes`);
 * - what is drawn on top at a point — the DOM's topmost box, the nearest
 *   drawn plane — is what the model's `hitTest` finds there, for raised,
 *   sunk and same-depth overlapping cards, from oblique orbits and from
 *   behind;
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
  paintPlanes,
  panOfView,
  projectPoint,
  screenToPlane,
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
    { id: "twin", type: "text", text: "same depth", x: 60, y: 50, width: 200, height: 100 },
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
/** The views each projection is handed, and holds its own way: a desk tilt, oblique, from behind. */
const ASKED: readonly CanvasView[] = [
  { x: 300, y: 80, z: 0, zoom: 0.8, yaw: -0.35, pitch: 0.5, fov: 34 },
  { x: 300, y: 80, z: 0, zoom: 0.7, yaw: 1.05, pitch: 1.1, fov: 34 },
  { x: 300, y: 80, z: 0, zoom: 0.8, yaw: Math.PI - 0.45, pitch: -0.35, fov: 34 },
];
/** Points where cards overlap, on the plane between them: raised over low, twin over low. */
const OVERLAPS = [
  { x: 175, y: 70, z: 40 },
  { x: 100, y: 75, z: 0 },
];

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
  /** An item's rectangle corners as drawn, on screen. */
  cornersOf(id: string): { x: number; y: number }[] | null;
  /** The item drawn on top at a screen point. */
  topAt(point: { x: number; y: number }): string | null;
  update(next: CanvasDoc): Promise<void>;
  dispose(): void;
}

type Mount = (view: CanvasView) => Promise<Probe>;

/** Whether `p` is inside the convex quad `corners` (either winding). */
function inside(
  p: { x: number; y: number },
  corners: readonly { x: number; y: number }[],
): boolean {
  let sign = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    if (a === undefined || b === undefined) return false;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

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
    cornersOf: (id) => {
      const el = cards().find((c) => c.dataset.cardId === id);
      const b = el === undefined ? null : box(el);
      if (b === null) return null;
      return [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
        { x: b.x, y: b.y + b.h },
      ];
    },
    // Positioned siblings in one stacking context: the last one laid out over the point is on top.
    topAt: (p) =>
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
    cornersOf: (id) => inspect().drawnOf(id)?.corners ?? null,
    // The depth buffer's answer: of the drawn rectangles under the point, the nearest drawn plane.
    topAt: (p) => {
      let best: { id: string; depth: number } | null = null;
      for (const id of inspect().items) {
        const drawn = inspect().drawnOf(id);
        if (drawn === null || !inside(p, drawn.corners)) continue;
        const on = screenToPlane(view, size, p, drawn.z);
        const depth = on === null ? null : projectPoint(view, size, on)?.depth;
        if (depth === undefined || depth === null) continue;
        if (best === null || depth < best.depth) best = { id, depth };
      }
      return best?.id ?? null;
    },
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

/** An item's rectangle corners on the plane `z`, clockwise from the top left. */
const cornersOf = (item: CanvasNode, z: number) => [
  { x: item.x, y: item.y, z },
  { x: item.x + item.width, y: item.y, z },
  { x: item.x + item.width, y: item.y + item.height, z },
  { x: item.x, y: item.y + item.height, z },
];

const centreOf = (item: CanvasNode) => ({
  x: item.x + item.width / 2,
  y: item.y + item.height / 2,
  z: item.z ?? 0,
});

describe("canvas projection contract", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, unknown>();

  beforeAll(async () => {
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
    // Both renderers load before the clock starts: three alone takes seconds to import cold.
    await Promise.all([import("./canvas-stage"), import("./canvas-scene")]);
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

  const cases = CANVAS_PROJECTIONS.flatMap((p) =>
    ASKED.map((asked, i) => [`${p.kind}, view ${i + 1}`, p.kind, asked] as const),
  );
  describe.each(cases)("%s", (_name, kind, asked) => {
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

    it("draws every item's corners where the model projects them on its paint plane", async () => {
      const probe = await mount(view);
      for (const { item, z } of paintPlanes(paintOrder(doc.nodes))) {
        const drawn = probe.cornersOf(item.id);
        expect(drawn, item.id).not.toBeNull();
        cornersOf(item, z).forEach((corner, i) => {
          const model = projectPoint(view, size, corner);
          expect(drawn?.[i]?.x, `${item.id} corner ${i}`).toBeCloseTo(model?.x ?? Number.NaN, 1);
          expect(drawn?.[i]?.y, `${item.id} corner ${i}`).toBeCloseTo(model?.y ?? Number.NaN, 1);
        });
      }
      probe.dispose();
    });

    it("draws on top at every point what the model's hit test finds there", async () => {
      const probe = await mount(view);
      const order = paintOrder(doc.nodes);
      const points = [...doc.nodes.map(centreOf), ...OVERLAPS]
        .map((p) => projectPoint(view, size, p))
        .filter((p) => p !== null);
      for (const at of points) {
        expect(probe.topAt(at), `at ${at.x.toFixed(0)},${at.y.toFixed(0)}`).toBe(
          hitTest(order, view, size, at),
        );
      }
      probe.dispose();
    });

    it("draws a moved card where it moved", async () => {
      const probe = await mount(view);
      const moved = doc.nodes.map((n) => (n.id === "sunk" ? { ...n, x: n.x + 120, z: 40 } : n));
      await probe.update({ ...doc, nodes: moved });
      const planes = paintPlanes(paintOrder(moved));
      const sunk = planes.find((p) => p.item.id === "sunk");
      expect(sunk).toBeDefined();
      if (sunk === undefined) return;
      const drawn = probe.cornersOf("sunk");
      cornersOf(sunk.item, sunk.z).forEach((corner, i) => {
        const model = projectPoint(view, size, corner);
        expect(drawn?.[i]?.x).toBeCloseTo(model?.x ?? Number.NaN, 1);
        expect(drawn?.[i]?.y).toBeCloseTo(model?.y ?? Number.NaN, 1);
      });
      probe.dispose();
    });
  });
});
