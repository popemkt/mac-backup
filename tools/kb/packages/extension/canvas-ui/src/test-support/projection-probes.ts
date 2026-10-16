/**
 * The probes the canvas projection contracts read every projection with
 * (DESIGN-UI.md → Canvas → Projections): one per registered projection,
 * mounting the real renderer — the DOM stage, and the scene on the GPU
 * stand-ins (`@kb/ui-test-kit`) — and reading back what it drew in the same
 * projection-free terms, so one property holds both to the camera model and
 * to the paint model. The geometry contract and the look contract share them.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, beforeAll } from "vitest";
import { Raycaster, Vector3, type Object3D } from "three/webgpu";
import {
  CANVAS_HEADS,
  type CanvasAlign,
  type CanvasDoc,
  type CanvasFont,
  type CanvasProjectionKind,
  type CanvasVAlign,
} from "@kb/canvas";
import {
  cameraPose,
  panOfView,
  screenToPlane,
  type CanvasView,
  type ViewSize,
} from "../canvas-camera";
import { CanvasCameraRig } from "../canvas-camera-rig";
import type { CardLook } from "../canvas-card-face";
import { FIRST_GIZMO } from "../canvas-gizmo";
import type { DrawnEdge } from "../canvas-scene-edges";
import type { CanvasSelection } from "../canvas-selection";
import {
  FLEX_PLACES,
  FONT_FACES,
  TEXT_ALIGNS,
  TYPE_STEPS,
  type CanvasTypeStep,
} from "../canvas-style";
import { TIMING_FALLBACK } from "@kb/ui-sdk";
import { fakeCanvasContexts, paintedOps, type PaintedOp } from "@kb/ui-test-kit";

/** What a probe mounts: the document, the shared selection, the viewport and the face look. */
interface ProbeScene {
  readonly doc: CanvasDoc;
  readonly selection: CanvasSelection;
  readonly size: ViewSize;
  readonly look: CardLook;
}

/** A look as a projection drew it, read back from what it drew. */
export interface DrawnLook {
  /** The outline's dash pattern and width, canvas units; null for no outline. */
  readonly outline: { readonly pattern: readonly number[]; readonly width: number } | null;
  readonly opacity: number;
  /** How the item's own words are set; null for an item whose words are not its own. */
  readonly words: {
    readonly font: CanvasFont;
    readonly step: CanvasTypeStep;
    readonly align: CanvasAlign;
    readonly valign: CanvasVAlign;
  } | null;
}

/** A line item as drawn, in its box's own units. */
interface DrawnLine {
  readonly line: readonly Point[];
  readonly heads: readonly (readonly Point[])[];
}

interface Probe {
  /** Item ids drawn, back to front. */
  drawn(): string[];
  edges(): string[];
  selected(): string[];
  /** An item's face corners as drawn, on screen. */
  cornersOf(id: string): { x: number; y: number }[] | null;
  /** The item drawn on top at a screen point. */
  topAt(point: { x: number; y: number }): string | null;
  /** An item's look as drawn. */
  paintOf(id: string): DrawnLook | null;
  /** An edge as drawn: its line's points and stroke, its opacity, its heads; null when not drawn. */
  edgeOf(id: string): DrawnEdge | null;
  /** A line item as drawn in its own box: the points of its line, and each head's, from end first. */
  lineOf(id: string): DrawnLine | null;
  update(next: CanvasDoc): Promise<void>;
  dispose(): void;
}

type Mount = (view: CanvasView, scene: ProbeScene) => Promise<Probe>;

type Point = { x: number; y: number };

/** The key of `table` whose value is `value`. */
function keyOf<K extends string, V>(table: Readonly<Record<K, V>>, value: V): K | undefined {
  return Object.keys(table)
    .filter((key): key is K => key in table)
    .find((key) => table[key] === value);
}

/** The design token a CSS `var()` names, or undefined. */
const tokenOf = (css: string) => /var\((--[\w-]+)\)/.exec(css)?.[1];

/** How words aligned along a line read back from CSS or a canvas's `textAlign`. */
const alignOf = (css: string): CanvasAlign | undefined => keyOf(TEXT_ALIGNS, css);

/** SVG path data (M, L, C, Z) as a polygon, curves flattened. */
function pathPolygon(d: string): Point[] {
  const tokens = d.match(/[MLCZ]|-?[\d.]+(?:e-?\d+)?/g) ?? [];
  const points: Point[] = [];
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
function inPolygon(p: Point, polygon: readonly Point[]) {
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
function footprintOf(el: HTMLElement): Point[] | null {
  const layer = el.querySelector<HTMLElement>("[data-footprint]");
  const clip = layer?.style.clipPath ?? "";
  const d = /path\("(.*)"\)/.exec(clip)?.[1];
  return d === undefined ? null : pathPolygon(d);
}

/** A solid's body as drawn: its path, as a polygon in canvas units. */
function bodyOf(el: HTMLElement): Point[] | null {
  const d = el.querySelector("[data-body] path")?.getAttribute("d");
  return d === null || d === undefined ? null : pathPolygon(d);
}

/**
 * What a browser does with a face's CSS `transform` and no perspective: the
 * `matrix3d` (column by column) about the box's centre, flattened onto the
 * screen — the 2 × 2 that x and y go through, and the shift. No transform
 * leaves the box where it is laid out.
 */
function flattened(el: HTMLElement) {
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
function drawnAt(f: LaidFace, q: Point) {
  const u = q.x - f.w / 2;
  const v = q.y - f.h / 2;
  return {
    x: f.x + f.w / 2 + f.m.a * u + f.m.c * v + f.m.e,
    y: f.y + f.h / 2 + f.m.b * u + f.m.d * v + f.m.f,
  };
}

/** A canvas point in the face's own box, or null where the face is seen edge-on. */
function onFace(f: LaidFace, p: Point) {
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

/** The face's laid-out box in canvas units, and its transform as the browser flattens it. */
function laidFace(el: HTMLElement): LaidFace | null {
  const laid = el.style.left === "" ? el.querySelector<HTMLElement>("[style*='left']") : el;
  if (laid === null) return null;
  const [x = 0, y = 0, w = 0, h = 0] = [
    laid.style.left,
    laid.style.top,
    laid.style.width,
    laid.style.height,
  ].map(px);
  return { x, y, w, h, m: flattened(laid) };
}

/** The outline an item's DOM chrome strokes, or null for none. */
function outline2d(el: HTMLElement): DrawnLook["outline"] {
  const path = el.querySelector("[data-outline-path]");
  const stroke = path?.getAttribute("stroke") ?? "none";
  if (path === null || stroke === "none") return null;
  const dashes = path.getAttribute("stroke-dasharray") ?? "";
  return {
    pattern: dashes === "" ? [] : dashes.split(" ").map(Number),
    width: Number(path.getAttribute("stroke-width")),
  };
}

/** An edge as the DOM draws it: its path, its stroke, its group's opacity, and its heads' paths. */
function edge2d(el: Element): DrawnEdge | null {
  const path = el.querySelector("[data-edge-path]");
  const d = path?.getAttribute("d");
  if (path === null || d === null || d === undefined) return null;
  const dashes = path.getAttribute("stroke-dasharray") ?? "";
  const opacity = el.getAttribute("opacity");
  const heads = [...el.querySelectorAll("[data-edge-head]")].flatMap((head) => {
    const end = head.getAttribute("data-edge-head") === "from" ? "from" : "to";
    const kind = CANVAS_HEADS.find((k) => k === head.getAttribute("data-head-kind"));
    const outline = head.getAttribute("d");
    if (kind === undefined || outline === null) return [];
    const filled = (head.getAttribute("fill") ?? "none") !== "none";
    return [{ end, kind, filled, points: pathPolygon(outline) } as const];
  });
  return {
    points: pathPolygon(d),
    line:
      (path.getAttribute("stroke") ?? "none") === "none"
        ? null
        : {
            pattern: dashes === "" ? [] : dashes.split(" ").map(Number),
            width: Number(path.getAttribute("stroke-width")),
          },
    opacity: opacity === null ? 1 : Number(opacity),
    heads,
  };
}

/** How an item's words are set in the DOM: by the tokens their style names, and where they sit. */
function words2d(el: HTMLElement): DrawnLook["words"] {
  const words = el.querySelector<HTMLElement>("[data-words]");
  if (words === null) return null;
  const placed = words.style.justifyContent === "" ? words.parentElement : words;
  const font = keyOf(FONT_FACES, tokenOf(words.style.fontFamily));
  const size = keyOf(TYPE_STEPS, tokenOf(words.style.fontSize));
  const align = alignOf(words.style.textAlign);
  const valign = (["top", "middle", "bottom"] as const).find(
    (v) => FLEX_PLACES[v] === placed?.style.justifyContent,
  );
  if (font === undefined || size === undefined || align === undefined || valign === undefined) {
    return null;
  }
  return { font, step: TYPE_STEPS[size], align, valign };
}

/** The stage's props for `current`, at `pan` and `zoom`, with no gesture under way. */
function stageProps(current: CanvasDoc, scene: ProbeScene, pan: Point, zoom: number) {
  return {
    doc: current,
    nodes: new Map(),
    byId: new Map(current.nodes.map((n) => [n.id, n])),
    selection: scene.selection,
    pan,
    zoom,
    panning: false,
    onModalPress: () => false,
    toolState: { tool: "select" as const },
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
  };
}

/** The DOM stage, and the box each card is laid out in under its CSS transform. */
const mount2d: Mount = async (view, scene) => {
  const { CanvasStage } = await import("../canvas-stage");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const { pan, zoom } = panOfView(view, scene.size);
  const render = (current: CanvasDoc) =>
    act(() => root.render(createElement(CanvasStage, stageProps(current, scene, pan, zoom))));
  render(scene.doc);
  const cards = () => [...container.querySelectorAll<HTMLElement>("[data-card-id]")];
  const card = (id: string) => cards().find((c) => c.dataset.cardId === id);
  const toScreen = (p: Point) => ({ x: p.x * zoom + pan.x, y: p.y * zoom + pan.y });
  /** Whether `el`'s body, or its face within its footprint, covers canvas point `at`. */
  const covers = (el: HTMLElement, at: Point) => {
    const body = bodyOf(el);
    if (body !== null && inPolygon(at, body)) return true;
    const f = laidFace(el);
    const q = f === null ? null : onFace(f, at);
    if (f === null || q === null || q.x < 0 || q.x > f.w || q.y < 0 || q.y > f.h) return false;
    const footprint = footprintOf(el);
    return footprint === null || inPolygon(q, footprint);
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
      const el = card(id);
      const f = el === undefined ? null : laidFace(el);
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
      cards().findLast((el) => covers(el, { x: (p.x - pan.x) / zoom, y: (p.y - pan.y) / zoom }))
        ?.dataset.cardId ?? null,
    edgeOf: (id) => {
      const el = container.querySelector(`[data-edge-id="${id}"]`);
      return el === null ? null : edge2d(el);
    },
    lineOf: (id) => {
      const d = card(id)?.querySelector("[data-outline-path]")?.getAttribute("d");
      if (d === null || d === undefined) return null;
      const heads = [...(card(id)?.querySelectorAll("[data-item-head]") ?? [])].map((head) =>
        pathPolygon(head.getAttribute("d") ?? ""),
      );
      return { line: pathPolygon(d), heads };
    },
    paintOf: (id) => {
      const el = card(id);
      if (el === undefined) return null;
      const opacity = el.style.opacity === "" ? 1 : Number(el.style.opacity);
      return { outline: outline2d(el), opacity, words: words2d(el) };
    },
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

/**
 * The eye's ray through a screen point, in three's world (canvas y
 * flipped): from the eye in perspective, from far back square to the screen
 * through the orthographic lens. Built from the camera model alone.
 */
function rayThrough(view: CanvasView, size: ViewSize, p: Point) {
  const floor = screenToPlane(view, size, p, -400);
  const from = view.fov > 0 ? cameraPose(view, size).eye : screenToPlane(view, size, p, 4000);
  if (floor === null || from === null) return null;
  const origin = new Vector3(from.x, -from.y, from.z);
  const dir = new Vector3(floor.x, -floor.y, floor.z).sub(origin).normalize();
  return { origin, dir };
}

/**
 * How a face texture's words were painted, from its recorded draw ops: the
 * face and step of its font (read back through the look), its alignment, and
 * where the block of lines stands about the box's middle, which tells its
 * place up and down it.
 */
function words3d(ops: readonly PaintedOp[], look: CardLook, height: number): DrawnLook["words"] {
  const lines = ops.filter((o) => o.op === "text");
  const [first] = lines;
  const set = first === undefined ? null : /([\d.]+)px (.*)$/.exec(first.font);
  if (first === undefined || set === null) return null;
  const font = keyOf(look.faces, set[2]);
  const step = keyOf(look.steps, Number(set[1]));
  const align = alignOf(first.align);
  if (font === undefined || step === undefined || align === undefined) return null;
  const block = (first.y + (lines.at(-1)?.y ?? first.y)) / 2 - height / 2;
  const valign = block < -0.5 ? "top" : block > 0.5 ? "bottom" : "middle";
  return { font, step, align, valign };
}

/** The scene on the GPU stand-ins, read back through its inspection. */
const mount3d: Mount = async (view, probed) => {
  const { mountCanvasScene } = await import("../canvas-scene");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const rig = new CanvasCameraRig(view, TIMING_FALLBACK, true);
  let current = probed.doc;
  const scene = await mountCanvasScene(host, {
    rig,
    content: { doc: current, nodes: new Map(), selection: probed.selection },
    look: probed.look,
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
  scene.resize(probed.size.width, probed.size.height);
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
      const ray = rayThrough(view, probed.size, p);
      if (ray === null) return null;
      const raycaster = new Raycaster(ray.origin, ray.dir);
      const [first] = raycaster.intersectObjects([...bodies.keys()], false);
      return first === undefined ? null : (bodies.get(first.object) ?? null);
    },
    edgeOf: (id) => inspect().edgeOf(id),
    // The face's line is its first stroke; what is painted after it, the heads.
    lineOf: (id) => {
      const canvas = inspect().faceOf(id)?.canvas;
      if (canvas === undefined) return null;
      const ops = paintedOps(canvas);
      const first = ops.findIndex((o) => o.op === "stroke");
      const line = ops[first];
      if (line === undefined || line.op !== "stroke") return null;
      const heads = ops.slice(first + 1).flatMap((o) => (o.op === "text" ? [] : [o.points]));
      return { line: line.points, heads };
    },
    paintOf: (id) => {
      const face = inspect().faceOf(id);
      const item = current.nodes.find((n) => n.id === id);
      if (face === null || face.canvas === undefined || item === undefined) return null;
      const ops = paintedOps(face.canvas);
      const stroke = ops.find((o) => o.op === "stroke");
      return {
        outline: stroke === undefined ? null : { pattern: stroke.pattern, width: stroke.width },
        opacity: face.opacity,
        words: words3d(ops, probed.look, item.height),
      };
    },
    update: async (next) => {
      current = next;
      scene.setContent({ doc: next, nodes: new Map(), selection: probed.selection });
      await Promise.resolve();
    },
    dispose: () => {
      scene.dispose();
      host.remove();
    },
  };
};

/** One probe per registered projection: a contract proves the table lists exactly the registry. */
export const PROBES: Record<CanvasProjectionKind, Mount> = { "2d": mount2d, "3d": mount3d };

/** The look faces are painted with in a contract: fixed colours, faces and steps. */
export const PROBE_LOOK: CardLook = {
  face: "rgb(255, 255, 255)",
  ink: "rgb(20, 20, 20)",
  primary: "rgb(190, 120, 20)",
  danger: "rgb(200, 30, 30)",
  palette: { "1": "rgb(200, 40, 40)" },
  faces: { sans: "sans-serif", serif: "serif", mono: "monospace" },
  body: 14.5,
  steps: { "--type-label": 11, "--type-ui": 13, "--type-heading": 18, "--type-title": 20 },
  radius: 18,
  shapeRadius: 8,
};

/**
 * Stand the probes' page up for a suite, and take it down after: a
 * happy-dom window as the globals, every canvas given the stand-in 2D
 * context (which records what it paints), and both renderers loaded before the
 * clock starts (three alone takes seconds to import cold).
 */
export function useProbePage(): void {
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
    await Promise.all([import("../canvas-stage"), import("../canvas-scene")]);
  });
  afterAll(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  });
}
