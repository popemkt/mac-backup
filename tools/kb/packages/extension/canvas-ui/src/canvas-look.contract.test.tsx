/**
 * The canvas look contract (DESIGN-UI.md → Canvas → Looks are one paint):
 * every projection in `CANVAS_PROJECTIONS` draws an item's look as its style
 * says (`itemPaint`), read back from what it drew — the DOM's SVG outline
 * and its words' tokens, the scene's face texture as its 2D context was asked
 * to paint it and the opacity its materials take:
 *
 * - its outline's dash pattern, width and colour, or no outline at all;
 * - the colour its ground is filled with, or none, and the ink its words take;
 * - its opacity;
 * - the face and type step its own words are set in, aligned across the
 *   line and placed up and down its box;
 *
 * for every value of every look, and for each kind's defaults; a face that
 * stands in front of its solid (`faceStands`) as a label sets its words,
 * inks them and is drawn at its opacity as its look says; and an
 * edge as its route and look say (`edgeRoute`, `edgePaint`, `edgeHead`):
 *
 * - along its route, end to end, never further than a hair from the
 *   route's points, for every route and for anchors anywhere on an outline;
 * - its line's dash pattern, width and colour, or no line, and its opacity,
 *   faint where the field a native link names is gone;
 * - the head each end wears, filled or stroked, in the line's colour, on the
 *   outline the model gives it.
 *
 * Colours are compared resolved (`toneColor` through the probes' look), so
 * one tone said as CSS in the DOM and mixed into a texture in the scene
 * must come out the same colour.
 *
 * A projection that ignored a look, or drew it its own way, fails here.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  edgeHead,
  edgeRoute,
  faceStands,
  flipItems,
  isPathNode,
  itemOutline,
  outlinePoints,
  ownsWords,
  pathHeads,
  routePoints,
  withFlag,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type CanvasTextNode,
  edgePaint,
  itemPaint,
  type Tone,
} from "@kb/canvas";
import { edgeUnbound } from "./canvas-api";
import type { CanvasView, ViewSize } from "./canvas-camera";
import { toneColor } from "./canvas-card-face";
import type { CanvasSelection } from "./canvas-selection";
import { CANVAS_PROJECTIONS, canvasProjection } from "./canvas-projections";
import { syncUiPlugins } from "@kb/ui-sdk";
import { testBrowserHost, testHostPlugin } from "@kb/ui-test-kit";
import {
  PROBES,
  PROBE_LOOK,
  hexOf,
  useProbePage,
  type DrawnLook,
  type LookProbe,
  type ProbeScene,
} from "./test-support/projection-probes";
import type * as ThreeWebGpu from "three/webgpu";

beforeAll(() => syncUiPlugins([testHostPlugin(testBrowserHost())]));
afterAll(() => syncUiPlugins([]));

vi.mock("three/webgpu", async (importOriginal) => ({
  ...(await importOriginal<typeof ThreeWebGpu>()),
  ...(await import("@kb/ui-test-kit")).FAKE_WEBGPU,
}));

const text = (
  id: string,
  x: number,
  y: number,
  more: Partial<CanvasTextNode> = {},
): CanvasTextNode => ({
  id,
  type: "text",
  text: id,
  x,
  y,
  width: 180,
  height: 140,
  ...more,
});

/** Every value of every look on some item, beside each kind's defaults. */
const doc: CanvasDoc = {
  nodes: [
    text("plain", 0, 0),
    {
      id: "shape",
      type: "shape",
      shape: "ellipse",
      label: "shape",
      x: 220,
      y: 0,
      width: 160,
      height: 120,
    },
    { id: "frame", type: "group", label: "Frame", x: 420, y: 0, width: 220, height: 140 },
    text("inked", 0, 200, {
      color: "blue",
      style: { dash: "dashed", size: "l", font: "serif", align: "end", valign: "bottom" },
    }),
    {
      id: "dots",
      type: "shape",
      shape: "rect",
      label: "dots",
      x: 220,
      y: 200,
      width: 160,
      height: 140,
      color: "4",
      style: {
        dash: "dotted",
        fill: "solid",
        font: "mono",
        align: "start",
        valign: "top",
        size: "s",
      },
    },
    text("faint", 420, 200, {
      style: {
        dash: "none",
        fill: "none",
        opacity: 0.4,
        size: "xl",
        align: "middle",
        valign: "middle",
      },
    }),
    {
      id: "boxed",
      type: "group",
      label: "Boxed",
      x: 0,
      y: 400,
      width: 220,
      height: 140,
      style: { dash: "solid", size: "m", fill: "semi", valign: "bottom", align: "end" },
    },
    // A solid wears its face on its top; a raised card is turned.
    {
      id: "block",
      type: "shape",
      shape: "rect",
      label: "block",
      x: 260,
      y: 400,
      width: 140,
      height: 120,
      depth: 60,
      style: { dash: "dashed", font: "serif" },
    },
    text("tilted", 440, 400, {
      z: 40,
      rotation: { z: 20 },
      style: { valign: "middle", size: "s" },
    }),
    // Lines: plain, an arrow worn at both ends and turned, and one that closes.
    {
      id: "line",
      type: "path",
      points: [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
      x: 0,
      y: 600,
      width: 200,
      height: 24,
    },
    {
      id: "arrowed",
      type: "path",
      points: [
        { x: 0, y: 1 },
        { x: 0.5, y: 0 },
        { x: 1, y: 0.8 },
      ],
      fromHead: "dot",
      toHead: "open",
      rotation: { z: 30 },
      color: "1",
      x: 240,
      y: 580,
      width: 180,
      height: 90,
      style: { dash: "dashed", size: "l", opacity: 0.6 },
    },
    // A sphere's face stands in front of it as a label.
    {
      id: "globe",
      type: "shape",
      shape: "sphere",
      label: "globe",
      x: 660,
      y: 200,
      width: 140,
      height: 120,
      depth: 80,
      color: "1",
      style: { size: "l", font: "serif", align: "start", valign: "top", opacity: 0.7 },
    },
    {
      id: "closed",
      type: "path",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0.2 },
        { x: 0.4, y: 1 },
      ],
      closed: true,
      toHead: "arrow",
      x: 460,
      y: 580,
      width: 140,
      height: 100,
      style: { fill: "solid", dash: "dotted" },
    },
  ],
  edges: [],
};

/** What the look contract reads an item's look by: its own words, or the line it is, where it lies. */
const looked = (item: CanvasNode) => (ownsWords(item) || isPathNode(item)) && !faceStands(item);

/** What a standing face's label carries of its look: its words, their ink, its opacity. */
const labelled = (look: DrawnLook | null) =>
  look === null ? null : { words: look.words, ink: look.ink, opacity: look.opacity };
const selection: CanvasSelection = { nodeIds: new Set(), edgeIds: new Set() };
const size: ViewSize = { width: 1000, height: 700 };
const scene = { doc, selection, size, look: PROBE_LOOK };

/** The views a look is read through: from the top, and an oblique turn. */
const ASKED: readonly CanvasView[] = [
  { x: 320, y: 270, z: 0, zoom: 0.8, yaw: 0, pitch: 0, fov: 0 },
  { x: 320, y: 270, z: 0, zoom: 0.7, yaw: 0.6, pitch: 0.8, fov: 34 },
];

/** A tone as the probes compare it: resolved through their look, as `#rrggbb`. */
const colorOf = (tone: Tone) => hexOf(toneColor(PROBE_LOOK, tone));

/** The look `itemPaint` says an item is drawn with, in the probes' terms. */
function modelLook(item: CanvasNode): DrawnLook {
  const paint = itemPaint(item);
  const { chrome, words } = paint;
  const outline = chrome?.outline ?? null;
  return {
    outline:
      outline === null || chrome === null
        ? null
        : { pattern: outline.pattern, width: outline.width, color: colorOf(chrome.stroke) },
    ground: chrome === null || chrome.ground === null ? null : colorOf(chrome.ground),
    ink: words === null ? null : colorOf(paint.ink.words),
    opacity: paint.opacity,
    words:
      words === null
        ? null
        : { font: words.font, step: words.step, align: words.align, valign: words.valign },
  };
}

/** Items for edges to join, of every footprint, one raised. */
const joined: CanvasNode[] = [
  text("a", 0, 0),
  { id: "b", type: "shape", shape: "ellipse", label: "b", x: 420, y: 40, width: 160, height: 120 },
  { id: "c", type: "shape", shape: "diamond", label: "c", x: 60, y: 360, width: 160, height: 140 },
  text("d", 460, 380, { z: 60, rotation: { z: 25 } }),
];

/** Every route, every head, every line look, and anchors off a side's middle. */
const wired: CanvasEdge[] = [
  { id: "plain", fromNode: "a", toNode: "b" },
  {
    id: "straight",
    fromNode: "a",
    toNode: "c",
    fromSide: "bottom",
    toSide: "top",
    route: "straight",
    fromEnd: "arrow",
    fromHead: "dot",
    toHead: "diamond",
    style: { dash: "dashed", size: "s" },
  },
  {
    id: "arc",
    fromNode: "b",
    toNode: "d",
    fromSide: "bottom",
    fromAnchor: { x: 0.8, y: 0.95 },
    toSide: "top",
    toAnchor: { x: 0.3, y: 0 },
    route: "arc",
    bend: 40,
    toHead: "open",
    color: "4",
    style: { dash: "dotted", size: "xl", opacity: 0.5 },
  },
  {
    id: "elbow",
    fromNode: "c",
    toNode: "d",
    route: "elbow",
    bend: -20,
    toHead: "bar",
    style: { size: "l" },
  },
  {
    id: "bare",
    fromNode: "d",
    toNode: "a",
    fromSide: "left",
    toSide: "right",
    route: "arc",
    toEnd: "none",
    style: { dash: "none" },
  },
  // A native link whose field is gone from its node (the probes hold no nodes): drawn faint.
  {
    id: "unbound",
    fromNode: "b",
    toNode: "c",
    route: "straight",
    kbLink: {
      mode: "native",
      via: "prop",
      fieldId: "f",
      sourceNodeId: "s",
      targetNodeId: "t",
      bindingId: "k",
    },
  },
];
const edgeScene = { ...scene, doc: { nodes: joined, edges: wired } };

/** How far `p` is from the polyline through `line`, across the floor. */
function offLine(p: { x: number; y: number }, line: readonly { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    if (a === undefined || b === undefined) continue;
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const span = dx * dx + dy * dy;
    const t =
      span === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / span));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

/** Whether two polylines run within a hair of each other, every point of each on the other. */
function alongside(drawn: readonly Point[], model: readonly Point[], what: string): void {
  expect(drawn.length, what).toBeGreaterThan(1);
  for (const p of drawn) expect(offLine(p, model), what).toBeLessThan(0.75);
  for (const p of model) expect(offLine(p, drawn), what).toBeLessThan(0.75);
}

type Point = { x: number; y: number };

/** A closed outline's points with its first again at the end, so its closing side is a side. */
const closed = (points: readonly Point[]) =>
  points[0] === undefined ? [] : [...points, points[0]];

/** A head as worn, in words: which end, what kind, filled or stroked. */
const worn = (head: { end: string; kind: string; filled: boolean }) =>
  `${head.end} ${head.kind} ${head.filled ? "filled" : "stroked"}`;

const byName = (a: string, b: string) => a.localeCompare(b);

/** How an edge of the contract stands: unselected, unbound when its field is gone. */
const standing = (edge: CanvasEdge) => ({
  selected: false,
  unbound: edgeUnbound(edge, new Map()),
});

/** What the model says an edge looks like: its line and opacity. */
function modelEdge(edge: CanvasEdge) {
  const paint = edgePaint(edge, standing(edge));
  const color = colorOf(paint.ink);
  const line =
    paint.line === null ? null : { pattern: paint.line.pattern, width: paint.line.width, color };
  return { line, opacity: paint.opacity };
}

/** Whether `probe` draws every line of `shown` through its points, with the heads its open ends wear. */
function expectLinesAsModel(probe: LookProbe, shown: CanvasDoc): void {
  for (const item of shown.nodes.filter(isPathNode)) {
    const paint = itemPaint(item);
    const model = outlinePoints(itemOutline(item, item.width, item.height, 0)).map(([x, y]) => ({
      x,
      y,
    }));
    const drawn = probe.lineOf(item.id);
    const ring = item.closed === true ? closed : (points: readonly Point[]) => points;
    alongside(ring(drawn?.line ?? []), ring(model), item.id);
    const heads = pathHeads(item, item.width, item.height, paint.heads?.length ?? 0);
    expect(drawn?.heads.length, item.id).toBe(heads.length);
    heads.forEach(({ end, head }, i) => {
      const outline = outlinePoints(head.path).map(([x, y]) => ({ x, y }));
      const shape = head.filled ? closed : (points: readonly Point[]) => points;
      const got = drawn?.heads[i];
      alongside(shape(got?.points ?? []), shape(outline), `${item.id} ${end}`);
      // A head is inked as its line is, drawn or not.
      const stroke = paint.chrome?.stroke;
      expect(got?.color, `${item.id} ${end} ink`).toBe(
        stroke === undefined ? undefined : colorOf(stroke),
      );
    });
  }
}

/** Whether `probe` draws every edge of `shown` along its route, end to end, with its line and opacity. */
function expectEdgesAsModel(probe: LookProbe, shown: CanvasDoc): void {
  const byId = new Map(shown.nodes.map((n) => [n.id, n]));
  for (const edge of shown.edges) {
    const [from, to] = [byId.get(edge.fromNode), byId.get(edge.toNode)];
    if (from === undefined || to === undefined) throw new Error(`no ends for ${edge.id}`);
    const model = routePoints(edgeRoute(from, to, edge));
    const drawn = probe.edgeOf(edge.id);
    const points = drawn?.points ?? [];
    for (const [got, want] of [
      [points[0], model[0]],
      [points.at(-1), model.at(-1)],
    ] as const) {
      // The DOM writes its path to the hundredth.
      expect(got?.x, edge.id).toBeCloseTo(want?.x ?? Number.NaN, 1);
      expect(got?.y, edge.id).toBeCloseTo(want?.y ?? Number.NaN, 1);
    }
    alongside(points, model, edge.id);
    expect({ line: drawn?.line, opacity: drawn?.opacity }, edge.id).toEqual(modelEdge(edge));
  }
}

describe("canvas look contract", () => {
  useProbePage();

  it("proves every registered projection", () => {
    expect(Object.keys(PROBES).toSorted()).toEqual(
      CANVAS_PROJECTIONS.map((p) => p.kind).toSorted(),
    );
  });

  /** Every painter the contract holds: each camera projection, from each asked view. */
  const painters: readonly {
    readonly name: string;
    readonly mount: (scene: ProbeScene) => Promise<LookProbe>;
  }[] = CANVAS_PROJECTIONS.flatMap((p) =>
    ASKED.map((asked, i) => {
      const view = canvasProjection(p.kind).settle(asked);
      return {
        name: `${p.kind}, view ${i + 1}`,
        mount: (shown: ProbeScene) => PROBES[p.kind](view, shown),
      };
    }),
  );
  describe.each(painters)("$name", ({ mount }) => {
    it("draws every item's look as its style says, every look and each kind's defaults", async () => {
      const probe = await mount(scene);
      for (const item of doc.nodes.filter(looked)) {
        expect(probe.paintOf(item.id), item.id).toEqual(modelLook(item));
      }
      probe.dispose();
    });

    it("draws a standing face's words, their ink and its opacity as its look says", async () => {
      const probe = await mount(scene);
      const stood = doc.nodes.filter((item) => ownsWords(item) && faceStands(item));
      expect(stood.length).toBeGreaterThan(0);
      for (const item of stood) {
        expect(labelled(probe.paintOf(item.id)), item.id).toEqual(labelled(modelLook(item)));
      }
      probe.dispose();
    });

    it("draws every edge along its route, end to end, with its line and opacity", async () => {
      const probe = await mount(edgeScene);
      expectEdgesAsModel(probe, edgeScene.doc);
      probe.dispose();
    });

    it("draws the head each end wears, filled or stroked, where the model puts it", async () => {
      const probe = await mount(edgeScene);
      const byId = new Map(joined.map((n) => [n.id, n]));
      for (const edge of wired) {
        const [from, to] = [byId.get(edge.fromNode), byId.get(edge.toNode)];
        if (from === undefined || to === undefined) throw new Error(`no ends for ${edge.id}`);
        const route = edgeRoute(from, to, edge);
        const paint = edgePaint(edge, standing(edge));
        const length = paint.headLength;
        const heads = (["from", "to"] as const).flatMap((end) => {
          const head = edgeHead(edge, route, end, length);
          return head === null ? [] : [{ end, head }];
        });
        const drawn = probe.edgeOf(edge.id)?.heads ?? [];
        expect(drawn.map(worn).toSorted(byName), edge.id).toEqual(
          heads.map(({ end, head }) => worn({ end, ...head })).toSorted(byName),
        );
        for (const { end, head } of heads) {
          const wornHead = drawn.find((h) => h.end === end);
          expect(wornHead?.color, `${edge.id} ${end} ink`).toBe(colorOf(paint.ink));
          const got = wornHead?.points ?? [];
          const model = outlinePoints(head.path).map(([x, y]) => ({ x, y }));
          const ring = head.filled ? closed : (points: readonly Point[]) => points;
          alongside(ring(got), ring(model), `${edge.id} ${end}`);
        }
      }
      probe.dispose();
    });

    it("draws a line through its points, with the heads its open ends wear", async () => {
      const probe = await mount(scene);
      expectLinesAsModel(probe, doc);
      probe.dispose();
    });

    it("draws a mirrored line and edge as the mirror put them: points, route and heads", async () => {
      const lines = await mount(scene);
      const edges = await mount(edgeScene);
      for (const axis of ["x", "y"] as const) {
        const flippedLines = flipItems(doc, ["line", "arrowed", "closed"], axis);
        await lines.update(flippedLines);
        expectLinesAsModel(lines, flippedLines);
        // b and d mirrored whole bend their arc the mirrored way; the rest meet them where they did.
        const flippedEdges = flipItems(edgeScene.doc, ["b", "d"], axis);
        await edges.update(flippedEdges);
        expectEdgesAsModel(edges, flippedEdges);
      }
      lines.dispose();
      edges.dispose();
    });

    it("draws a locked item's look as any other's: a lock is no look", async () => {
      const probe = await mount(scene);
      const locked = { ...doc, nodes: doc.nodes.map((n) => withFlag(n, "locked", true)) };
      await probe.update(locked);
      for (const item of locked.nodes.filter(looked)) {
        expect(probe.paintOf(item.id), item.id).toEqual(modelLook(item));
      }
      probe.dispose();
    });

    it("draws a look changed in the document as it now says", async () => {
      const probe = await mount(scene);
      const changed = doc.nodes.map((n) =>
        n.id === "plain" ? { ...n, style: { dash: "dotted" as const, font: "mono" as const } } : n,
      );
      await probe.update({ ...doc, nodes: changed });
      const plain = changed.find((n) => n.id === "plain");
      if (plain === undefined) throw new Error("no plain");
      expect(probe.paintOf("plain")).toEqual(modelLook(plain));
      probe.dispose();
    });
  });
});
