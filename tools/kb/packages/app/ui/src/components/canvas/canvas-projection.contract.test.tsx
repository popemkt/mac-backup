/**
 * The canvas projection contract (DESIGN-UI.md → Canvas → Projections): what
 * every projection in `CANVAS_PROJECTIONS` promises about one document, proved
 * over each of them with the view that projection holds.
 *
 * - it draws every item once, back to front in paint order;
 * - it draws every edge whose two ends exist, and no other;
 * - it marks exactly the shared selection;
 * - every item's face is drawn where the one camera model projects it: the
 *   corners of the plane its face lies on (`faceShare`), turned with the
 *   item, over its paint plane (`paintPlanes`);
 * - what is drawn on top at a point — in the DOM the topmost card whose
 *   footprint (its clip path, which the browser both paints and hit-tests
 *   by) covers it, in the scene the first drawn surface a ray meets — is
 *   what the model's `hitTest` finds there, for raised, sunk and same-height
 *   overlapping cards and for every solid, from oblique orbits, low across
 *   the floor and through either lens;
 * - footprint parity: over a grid across every item's box, inside its
 *   footprint and in its corners outside it, both of the above agree with
 *   the model, so what 2D draws and hit-tests is each solid's top view —
 *   for turned items too, flat and solid, spun about z and tilted;
 * - a card moved and turned in the document is drawn where it went;
 * - nested membership: a frame paints under what belongs to it, at any
 *   depth and whatever the document order, and a frame's transform draws
 *   its members where it carried them.
 *
 * The 2D projection is the real DOM stage; the 3D one is the real scene on
 * the GPU stand-ins (`@kb/ui-test-kit`). A projection joins by its
 * registration: the table below must list exactly the registry.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Raycaster, Vector3, type Object3D } from "three/webgpu";
import {
  boxFrame,
  boxToLocal,
  boxToWorld,
  carriedBy,
  directionToLocal,
  faceShare,
  facesCamera,
  frameCorners,
  itemFrame,
  itemShape,
  onFootprint,
  paintOrder,
  planeCorners,
  selectionPivot,
  stillAbout,
  transformCarried,
  turnAbout,
  type CanvasDoc,
  type CanvasNode,
  type CanvasProjectionKind,
  type CanvasShapeKind,
} from "@kb/canvas";
import {
  cameraPose,
  hitTest,
  paintPlanes,
  panOfView,
  projectPoint,
  screenToPlane,
  viewAxes,
  type CanvasView,
  type ViewSize,
} from "./canvas-camera";
import { CanvasCameraRig } from "./canvas-camera-rig";
import type { CanvasSelection } from "./canvas-selection";
import { syncUiPlugins, TIMING_FALLBACK } from "@kb/ui-sdk";
import { fakeCanvasContexts } from "@kb/ui-test-kit";
import type { CardLook } from "./canvas-card-face";
import { CANVAS_PROJECTIONS, canvasProjection } from "./canvas-projections";
import { FIRST_GIZMO } from "./canvas-gizmo";
import type * as ThreeWebGpu from "three/webgpu";
import { browserHostUiPlugin } from "@/browser-host";

// The canvas reaches the shell through the page's host, as when the app boots.
beforeAll(() => syncUiPlugins([browserHostUiPlugin]));
afterAll(() => syncUiPlugins([]));

vi.mock("three/webgpu", async (importOriginal) => ({
  ...(await importOriginal<typeof ThreeWebGpu>()),
  ...(await import("@kb/ui-test-kit")).FAKE_WEBGPU,
}));

/** A shape item of `shape`, before it has an id or a place. */
const solid = (shape: CanvasShapeKind) => ({ type: "shape" as const, shape, label: shape });

const doc: CanvasDoc = {
  nodes: [
    { id: "frame", type: "group", label: "Frame", x: -40, y: -40, width: 720, height: 260 },
    {
      id: "low",
      type: "text",
      text: "on the plane",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      parent: "frame",
    },
    {
      id: "twin",
      type: "text",
      text: "same depth",
      x: 60,
      y: 50,
      width: 200,
      height: 100,
      parent: "frame",
    },
    // Nested membership, written before the groups it belongs to: each paints over its group.
    {
      id: "held",
      type: "text",
      text: "held",
      x: 50,
      y: 745,
      width: 120,
      height: 60,
      parent: "nest",
    },
    {
      id: "nest",
      type: "group",
      label: "Nest",
      x: 20,
      y: 720,
      width: 200,
      height: 120,
      parent: "late",
    },
    { id: "late", type: "group", label: "Late", x: 0, y: 700, width: 320, height: 200 },
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
    // Solids, and a flat shape whose box corners are open canvas.
    {
      id: "block",
      type: "text",
      text: "a block",
      x: 40,
      y: 260,
      width: 160,
      height: 90,
      depth: 60,
    },
    { id: "ball", ...solid("sphere"), x: 260, y: 250, width: 120, height: 120, depth: 120 },
    { id: "cone", ...solid("cone"), x: 420, y: 250, width: 110, height: 110, depth: 140 },
    { id: "pillar", ...solid("ellipse"), x: 580, y: 250, width: 70, height: 70, depth: 180 },
    { id: "gem", ...solid("diamond"), x: 560, y: 360, width: 120, height: 90, depth: 40 },
    { id: "disc", ...solid("ellipse"), x: 690, y: 260, width: 140, height: 80 },
    { id: "slab", ...solid("rect"), x: -200, y: 120, width: 160, height: 80, z: 100, depth: 12 },
    // Turned items, apart from the rest: spun about z, and tilted, flat and solid.
    {
      id: "spun",
      type: "text",
      text: "spun",
      x: 0,
      y: 540,
      width: 160,
      height: 90,
      rotation: { z: 30 },
    },
    {
      id: "tipped",
      type: "text",
      text: "tipped",
      x: 230,
      y: 540,
      width: 140,
      height: 80,
      z: 40,
      rotation: { x: 50, z: 20 },
    },
    {
      id: "crate",
      ...solid("rect"),
      x: 440,
      y: 540,
      width: 100,
      height: 80,
      depth: 60,
      rotation: { z: 25 },
    },
    {
      id: "leaning",
      ...solid("rect"),
      x: 640,
      y: 540,
      width: 110,
      height: 70,
      depth: 50,
      z: 20,
      rotation: { x: 30, y: -20, z: 15 },
    },
    {
      id: "orb",
      ...solid("sphere"),
      x: 840,
      y: 530,
      width: 100,
      height: 80,
      depth: 90,
      rotation: { x: 40, y: 25 },
    },
    // Billboards, apart: a label turned (which it does not show: it faces the camera), and a
    // raised one; a solid billboard keeps its body's turn.
    {
      id: "tag",
      type: "text",
      text: "tag",
      x: 1200,
      y: 250,
      width: 140,
      height: 50,
      billboard: true,
      rotation: { x: 30, z: 40 },
    },
    {
      id: "sign",
      type: "text",
      text: "sign",
      x: 1200,
      y: 420,
      width: 120,
      height: 60,
      z: 60,
      billboard: true,
    },
    {
      id: "post",
      ...solid("rect"),
      x: 1220,
      y: 560,
      width: 60,
      height: 60,
      depth: 90,
      billboard: true,
      rotation: { z: 20 },
    },
    {
      id: "spire",
      ...solid("cone"),
      x: 1020,
      y: 530,
      width: 90,
      height: 90,
      depth: 120,
      rotation: { y: 35, z: 10 },
    },
  ],
  edges: [
    { id: "e1", fromNode: "low", toNode: "raised", toEnd: "arrow" },
    { id: "e2", fromNode: "raised", toNode: "sunk", fromSide: "right", toSide: "top" },
    { id: "dangling", fromNode: "low", toNode: "nowhere" },
  ],
};
const selection: CanvasSelection = { nodeIds: new Set(["raised"]), edgeIds: new Set(["e2"]) };
const size: ViewSize = { width: 1000, height: 700 };
/**
 * The views each projection is handed, and holds its own way: a desk tilt,
 * an oblique turn, low across the floor from the far side, and an oblique
 * turn through the orthographic lens.
 */
const ASKED: readonly CanvasView[] = [
  { x: 300, y: 80, z: 0, zoom: 0.8, yaw: -0.35, pitch: 0.5, fov: 34 },
  { x: 300, y: 80, z: 0, zoom: 0.7, yaw: 1.05, pitch: 1.1, fov: 34 },
  { x: 300, y: 80, z: 0, zoom: 0.8, yaw: Math.PI - 0.45, pitch: 1.3, fov: 34 },
  { x: 300, y: 80, z: 0, zoom: 0.8, yaw: 0.7, pitch: 0.9, fov: 0 },
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
  /** An item's face corners as drawn, on screen. */
  cornersOf(id: string): { x: number; y: number }[] | null;
  /** The item drawn on top at a screen point. */
  topAt(point: { x: number; y: number }): string | null;
  update(next: CanvasDoc): Promise<void>;
  dispose(): void;
}

type Mount = (view: CanvasView) => Promise<Probe>;

/** SVG path data (M, L, C, Z) as a polygon, curves flattened. */
function pathPolygon(d: string): { x: number; y: number }[] {
  const tokens = d.match(/[MLCZ]|-?[\d.]+(?:e-?\d+)?/g) ?? [];
  const points: { x: number; y: number }[] = [];
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const op = tokens[i++];
    if (op === "M" || op === "L") points.push({ x: num(), y: num() });
    else if (op === "C") {
      const from = points.at(-1) ?? { x: 0, y: 0 };
      const [x1, y1, x2, y2, x, y] = [num(), num(), num(), num(), num(), num()];
      for (let s = 1; s <= 16; s++) {
        const t = s / 16;
        const u = 1 - t;
        points.push({
          x: u * u * u * from.x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
          y: u * u * u * from.y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
        });
      }
    }
  }
  return points;
}

/** Whether `p` is inside `polygon` (even-odd). */
function inPolygon(p: { x: number; y: number }, polygon: readonly { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** The clip path a card's footprint layer is drawn and hit through, as a polygon in the card's box. */
function footprintOf(el: HTMLElement): { x: number; y: number }[] | null {
  const layer = el.querySelector<HTMLElement>("[data-footprint]");
  const clip = layer?.style.clipPath ?? "";
  const d = /path\("(.*)"\)/.exec(clip)?.[1];
  return d === undefined ? null : pathPolygon(d);
}

/** A solid's body as drawn: its path, as a polygon in canvas units. */
function bodyOf(el: HTMLElement): { x: number; y: number }[] | null {
  const d = el.querySelector("[data-body] path")?.getAttribute("d");
  return d === null || d === undefined ? null : pathPolygon(d);
}

/**
 * What a browser does with a face's CSS `transform` and no perspective: the
 * `matrix3d` (column by column) about the box's centre, flattened onto the
 * screen — the 2 × 2 that x and y go through, and the shift. No transform
 * leaves the box where it is laid out.
 */
function flattened(el: HTMLElement): {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
} {
  const values = /matrix3d\(([^)]*)\)/.exec(el.style.transform)?.[1]?.split(",").map(Number);
  if (values === undefined) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const at = (i: number) => values[i] ?? Number.NaN;
  return { a: at(0), b: at(1), c: at(4), d: at(5), e: at(12), f: at(13) };
}

/** A face as the DOM lays it out: its box in canvas units, and its flattened transform. */
interface LaidFace {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly m: ReturnType<typeof flattened>;
}

/** A point of the face's own box (from its top left), where the browser draws it, canvas units. */
function drawnAt(f: LaidFace, q: { x: number; y: number }) {
  const u = q.x - f.w / 2;
  const v = q.y - f.h / 2;
  return {
    x: f.x + f.w / 2 + f.m.a * u + f.m.c * v + f.m.e,
    y: f.y + f.h / 2 + f.m.b * u + f.m.d * v + f.m.f,
  };
}

/** A canvas point in the face's own box, or null where the face is seen edge-on. */
function onFace(f: LaidFace, p: { x: number; y: number }) {
  const det = f.m.a * f.m.d - f.m.b * f.m.c;
  if (Math.abs(det) < 1e-6) return null;
  const dx = p.x - (f.x + f.w / 2) - f.m.e;
  const dy = p.y - (f.y + f.h / 2) - f.m.f;
  return {
    x: (f.m.d * dx - f.m.c * dy) / det + f.w / 2,
    y: (f.m.a * dy - f.m.b * dx) / det + f.h / 2,
  };
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
          onModalPress: () => false,
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
          onRotateStart: noop,
          onPortDown: noop,
          onWheel: noop,
          onPointerDownStage: noop,
          onPointerMove: noop,
          onPointerCancel: noop,
          onPointerUp: noop,
          onDoubleClickStage: noop,
          handleCardPointerDown: noop,
          handleEdgeClick: noop,
          editing: null,
          onEdit: noop,
        }),
      ),
    );
  render(doc);
  const cards = () => [...container.querySelectorAll<HTMLElement>("[data-card-id]")];
  /** The face's laid-out box in canvas units, and its transform as the browser flattens it. */
  const face = (el: HTMLElement): LaidFace | null => {
    const laid = el.style.left === "" ? el.querySelector<HTMLElement>("[style*='left']") : el;
    if (laid === null) return null;
    const [x, y, w, h] = [laid.style.left, laid.style.top, laid.style.width, laid.style.height].map(
      px,
    ) as [number, number, number, number];
    return { x, y, w, h, m: flattened(laid) };
  };
  const toScreen = (p: { x: number; y: number }) => ({
    x: p.x * zoom + pan.x,
    y: p.y * zoom + pan.y,
  });
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
      const f = el === undefined ? null : face(el);
      if (f === null) return null;
      return [
        { x: 0, y: 0 },
        { x: f.w, y: 0 },
        { x: f.w, y: f.h },
        { x: 0, y: f.h },
      ].map((q) => toScreen(drawnAt(f, q)));
    },
    // Positioned siblings in one stacking context: the last one whose body or face covers the point.
    topAt: (p) =>
      cards().findLast((el) => {
        const at = { x: (p.x - pan.x) / zoom, y: (p.y - pan.y) / zoom };
        const body = bodyOf(el);
        if (body !== null && inPolygon(at, body)) return true;
        const f = face(el);
        const q = f === null ? null : onFace(f, at);
        if (f === null || q === null || q.x < 0 || q.x > f.w || q.y < 0 || q.y > f.h) return false;
        const footprint = footprintOf(el);
        return footprint === null || inPolygon(q, footprint);
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
    gizmo: FIRST_GIZMO,
  });
  scene.setRunning(true);
  scene.resize(size.width, size.height);
  const inspect = () => scene.inspect();
  return {
    drawn: () => [...inspect().items],
    edges: () => [...inspect().edges],
    selected: () => [...inspect().selected],
    cornersOf: (id) => inspect().drawnOf(id)?.corners ?? null,
    // The depth buffer's answer: the first drawn surface the ray through the point meets.
    topAt: (p) => {
      const bodies = new Map<Object3D, string>();
      for (const id of inspect().items) {
        for (const body of inspect().bodiesOf(id)) bodies.set(body, id);
      }
      const ray = rayThrough(view, p);
      if (ray === null) return null;
      const raycaster = new Raycaster(ray.origin, ray.dir);
      const [first] = raycaster.intersectObjects([...bodies.keys()], false);
      return first === undefined ? null : (bodies.get(first.object) ?? null);
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

/**
 * The eye's ray through a screen point, in three's world (canvas y
 * flipped): from the eye in perspective, from far back square to the screen
 * through the orthographic lens. Built from the camera model alone.
 */
function rayThrough(view: CanvasView, p: { x: number; y: number }) {
  const floor = screenToPlane(view, size, p, -400);
  const from = view.fov > 0 ? cameraPose(view, size).eye : screenToPlane(view, size, p, 4000);
  if (floor === null || from === null) return null;
  const origin = new Vector3(from.x, -from.y, from.z);
  const dir = new Vector3(floor.x, -floor.y, floor.z).sub(origin).normalize();
  return { origin, dir };
}

/**
 * Whether the ray through `p` meets some rectangle where its corner is
 * rounded: a look both projections draw (`cornerRadius`) and the model
 * treats as square, so a point there may fall either way.
 */
function atRoundedCorner(view: CanvasView, p: { x: number; y: number }): boolean {
  const floor = screenToPlane(view, size, p, -400);
  const from = view.fov > 0 ? cameraPose(view, size).eye : screenToPlane(view, size, p, 4000);
  if (floor === null || from === null) return false;
  const ray = { x: floor.x - from.x, y: floor.y - from.y, z: floor.z - from.z };
  return paintPlanes(paintOrder(doc.nodes)).some(({ item, z }) => {
    if (itemShape(item) !== "rect") return false;
    // In the box's own frame it is centred on the origin along its own axes.
    const frame = boxFrame(item, z);
    const o = boxToLocal(frame, from);
    const d = directionToLocal(frame, ray);
    const origin = [o.x, o.y, o.z] as const;
    const dir = [d.x, d.y, d.z] as const;
    const half = [frame.half.x, frame.half.y, frame.half.z] as const;
    let enter = -Infinity;
    let exit = Infinity;
    for (const i of [0, 1, 2] as const) {
      const a = (-half[i] - origin[i]) / dir[i];
      const b = (half[i] - origin[i]) / dir[i];
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
    }
    if (enter > exit) return false;
    const x = origin[0] + dir[0] * enter;
    const y = origin[1] + dir[1] * enter;
    return half[0] - Math.abs(x) < CORNER && half[1] - Math.abs(y) < CORNER;
  });
}

/** Wider than any corner radius a card or a shape is drawn with, canvas units. */
const CORNER = 24;

/**
 * Points across every item's box, at half its height: on its footprint and
 * in the corners of its box off it, kept clear of the footprint's outline,
 * which a mesh only approximates.
 */
const footprintSamples = doc.nodes.flatMap((item) => {
  // Off the round numbers, so no sample sits on another item's edge.
  const steps = [-0.77, -0.37, 0.03, 0.43, 0.81];
  return steps.flatMap((u) =>
    steps.flatMap((v) => {
      const near = [0.1, -0.1].some(
        (d) =>
          onFootprint(itemShape(item), u * (1 + d), v * (1 + d)) !==
          onFootprint(itemShape(item), u, v),
      );
      if (near) return [];
      // Halfway up the box, in its own frame, turned with it.
      const frame = boxFrame(item);
      return [boxToWorld(frame, { x: u * frame.half.x, y: v * frame.half.y, z: 0 })];
    }),
  );
});

/** An item's face corners over the paint plane `z`, clockwise from the top left. */
const cornersOf = (item: CanvasNode, z: number, view: CanvasView) =>
  facesCamera(item)
    ? frameCorners(itemFrame(item, viewAxes(view), z)).slice(0, 4)
    : planeCorners(item, faceShare(item), z);

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

    it("draws every item's face where the model projects it, turned, over its paint plane", async () => {
      const probe = await mount(view);
      for (const { item, z } of paintPlanes(paintOrder(doc.nodes))) {
        const drawn = probe.cornersOf(item.id);
        expect(drawn, item.id).not.toBeNull();
        cornersOf(item, z, view).forEach((corner, i) => {
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

    it("draws and hits each item's top view: its footprint, not its box", async () => {
      const probe = await mount(view);
      const order = paintOrder(doc.nodes);
      const points = footprintSamples
        .map((p) => projectPoint(view, size, p))
        .filter((p) => p !== null)
        .filter((p) => !atRoundedCorner(view, p));
      expect(points.length).toBeGreaterThan(200);
      for (const at of points) {
        expect(probe.topAt(at), `at ${at.x.toFixed(1)},${at.y.toFixed(1)}`).toBe(
          hitTest(order, view, size, at),
        );
      }
      probe.dispose();
    });

    it("draws a frame's members where the frame's transform carried them", async () => {
      const probe = await mount(view);
      const carried = carriedBy(doc.nodes, ["late"]);
      const t = {
        ...stillAbout(selectionPivot(carried.items)),
        move: { x: 60, y: -20, z: 30 },
        turn: turnAbout({ x: 0, y: 0, z: 1 }, Math.PI / 6),
      };
      const moved = transformCarried(doc, carried, t);
      await probe.update(moved);
      const planes = paintPlanes(paintOrder(moved.nodes));
      expect(probe.drawn()).toEqual(paintOrder(moved.nodes).map((n) => n.id));
      for (const id of ["late", "nest", "held"]) {
        const plane = planes.find((p) => p.item.id === id);
        expect(plane, id).toBeDefined();
        if (plane === undefined) continue;
        const drawn = probe.cornersOf(id);
        cornersOf(plane.item, plane.z, view).forEach((corner, i) => {
          const model = projectPoint(view, size, corner);
          expect(drawn?.[i]?.x, `${id} corner ${i}`).toBeCloseTo(model?.x ?? Number.NaN, 1);
          expect(drawn?.[i]?.y, `${id} corner ${i}`).toBeCloseTo(model?.y ?? Number.NaN, 1);
        });
      }
      // What is on top over the carried member is what the model finds there.
      const held = moved.nodes.find((n) => n.id === "held");
      const at = held === undefined ? null : projectPoint(view, size, centreOf(held));
      expect(at).not.toBeNull();
      if (at !== null) {
        expect(probe.topAt(at)).toBe(hitTest(paintOrder(moved.nodes), view, size, at));
      }
      probe.dispose();
    });

    it("draws a moved and turned card where it went", async () => {
      const probe = await mount(view);
      const moved = doc.nodes.map((n) =>
        n.id === "sunk" ? { ...n, x: n.x + 120, z: 40, rotation: { x: 20, z: 40 } } : n,
      );
      await probe.update({ ...doc, nodes: moved });
      const planes = paintPlanes(paintOrder(moved));
      const sunk = planes.find((p) => p.item.id === "sunk");
      expect(sunk).toBeDefined();
      if (sunk === undefined) return;
      const drawn = probe.cornersOf("sunk");
      cornersOf(sunk.item, sunk.z, view).forEach((corner, i) => {
        const model = projectPoint(view, size, corner);
        expect(drawn?.[i]?.x).toBeCloseTo(model?.x ?? Number.NaN, 1);
        expect(drawn?.[i]?.y).toBeCloseTo(model?.y ?? Number.NaN, 1);
      });
      probe.dispose();
    });
  });
});
