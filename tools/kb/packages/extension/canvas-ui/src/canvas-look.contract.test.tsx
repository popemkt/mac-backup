/**
 * The canvas look contract (DESIGN-UI.md → Canvas → Looks are one paint):
 * every projection in `CANVAS_PROJECTIONS` draws an item's look as its style
 * says (`itemPaint`), read back from what it drew — the DOM's SVG outline
 * and its words' tokens, the scene's face texture as its 2D context was asked
 * to paint it and the opacity its materials take:
 *
 * - its outline's dash pattern and width, or no outline at all;
 * - its opacity;
 * - the face and type step its own words are set in, aligned across the
 *   line and placed up and down its box;
 *
 * for every value of every look, and for each kind's defaults; and an
 * edge as its route and look say (`edgeRoute`, `edgePaint`, `edgeHead`):
 *
 * - along its route, end to end, never further than a hair from the
 *   route's points, for every route and for anchors anywhere on an outline;
 * - its line's dash pattern and width, or no line, and its opacity;
 * - the head each end wears, filled or stroked, on the outline the model
 *   gives it.
 *
 * A projection that ignored a look, or drew it its own way, fails here.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  edgeHead,
  edgeRoute,
  isPathNode,
  itemOutline,
  outlinePoints,
  ownsWords,
  pathHeads,
  routePoints,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type CanvasTextNode,
} from "@kb/canvas";
import type { CanvasView, ViewSize } from "./canvas-camera";
import type { CanvasSelection } from "./canvas-selection";
import { edgePaint, itemPaint } from "./canvas-style";
import { CANVAS_PROJECTIONS, canvasProjection } from "./canvas-projections";
import { syncUiPlugins } from "@kb/ui-sdk";
import { testBrowserHost, testHostPlugin } from "@kb/ui-test-kit";
import { PROBES, PROBE_LOOK, useProbePage, type DrawnLook } from "./test-support/projection-probes";
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

/** What the look contract reads an item's look by: its own words, or the line it is. */
const looked = (item: CanvasNode) => ownsWords(item) || isPathNode(item);
const selection: CanvasSelection = { nodeIds: new Set(), edgeIds: new Set() };
const size: ViewSize = { width: 1000, height: 700 };
const scene = { doc, selection, size, look: PROBE_LOOK };

/** The views a look is read through: from the top, and an oblique turn. */
const ASKED: readonly CanvasView[] = [
  { x: 320, y: 270, z: 0, zoom: 0.8, yaw: 0, pitch: 0, fov: 0 },
  { x: 320, y: 270, z: 0, zoom: 0.7, yaw: 0.6, pitch: 0.8, fov: 34 },
];

/** The look `itemPaint` says an item is drawn with, in the probes' terms. */
function modelLook(item: CanvasNode): DrawnLook {
  const paint = itemPaint(item);
  const outline = paint.chrome?.outline ?? null;
  const words = paint.words;
  return {
    outline: outline === null ? null : { pattern: outline.pattern, width: outline.width },
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

/** What the model says an edge looks like: its line and opacity, and the kind of each head. */
function modelEdge(edge: CanvasEdge) {
  const paint = edgePaint(edge, false);
  const line =
    paint.line === null ? null : { pattern: paint.line.pattern, width: paint.line.width };
  return { line, opacity: paint.opacity };
}

describe("canvas look contract", () => {
  useProbePage();

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

    it("draws every item's look as its style says, every look and each kind's defaults", async () => {
      const probe = await PROBES[kind](view, scene);
      for (const item of doc.nodes.filter(looked)) {
        expect(probe.paintOf(item.id), item.id).toEqual(modelLook(item));
      }
      probe.dispose();
    });

    it("draws every edge along its route, end to end, with its line and opacity", async () => {
      const probe = await PROBES[kind](view, edgeScene);
      const byId = new Map(joined.map((n) => [n.id, n]));
      for (const edge of wired) {
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
      probe.dispose();
    });

    it("draws the head each end wears, filled or stroked, where the model puts it", async () => {
      const probe = await PROBES[kind](view, edgeScene);
      const byId = new Map(joined.map((n) => [n.id, n]));
      for (const edge of wired) {
        const [from, to] = [byId.get(edge.fromNode), byId.get(edge.toNode)];
        if (from === undefined || to === undefined) throw new Error(`no ends for ${edge.id}`);
        const route = edgeRoute(from, to, edge);
        const length = edgePaint(edge, false).headLength;
        const heads = (["from", "to"] as const).flatMap((end) => {
          const head = edgeHead(edge, route, end, length);
          return head === null ? [] : [{ end, head }];
        });
        const drawn = probe.edgeOf(edge.id)?.heads ?? [];
        expect(drawn.map(worn).toSorted(byName), edge.id).toEqual(
          heads.map(({ end, head }) => worn({ end, ...head })).toSorted(byName),
        );
        for (const { end, head } of heads) {
          const got = drawn.find((h) => h.end === end)?.points ?? [];
          const model = outlinePoints(head.path).map(([x, y]) => ({ x, y }));
          const ring = head.filled ? closed : (points: readonly Point[]) => points;
          alongside(ring(got), ring(model), `${edge.id} ${end}`);
        }
      }
      probe.dispose();
    });

    it("draws a line through its points, with the heads its open ends wear", async () => {
      const probe = await PROBES[kind](view, scene);
      for (const item of doc.nodes.filter(isPathNode)) {
        const paint = itemPaint(item);
        const model = outlinePoints(itemOutline(item, item.width, item.height, 0)).map(
          ([x, y]) => ({ x, y }),
        );
        const drawn = probe.lineOf(item.id);
        const ring = item.closed === true ? closed : (points: readonly Point[]) => points;
        alongside(ring(drawn?.line ?? []), ring(model), item.id);
        const heads = pathHeads(item, item.width, item.height, paint.heads?.length ?? 0);
        expect(drawn?.heads.length, item.id).toBe(heads.length);
        heads.forEach(({ end, head }, i) => {
          const outline = outlinePoints(head.path).map(([x, y]) => ({ x, y }));
          const shape = head.filled ? closed : (points: readonly Point[]) => points;
          alongside(shape(drawn?.heads[i] ?? []), shape(outline), `${item.id} ${end}`);
        });
      }
      probe.dispose();
    });

    it("draws a look changed in the document as it now says", async () => {
      const probe = await PROBES[kind](view, scene);
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
