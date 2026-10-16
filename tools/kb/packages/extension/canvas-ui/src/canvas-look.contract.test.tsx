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
 * for every value of every look, and for each kind's defaults. A projection
 * that ignored a look, or drew it its own way, fails here.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ownsWords, type CanvasDoc, type CanvasNode, type CanvasTextNode } from "@kb/canvas";
import type { CanvasView, ViewSize } from "./canvas-camera";
import type { CanvasSelection } from "./canvas-selection";
import { itemPaint } from "./canvas-style";
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
  ],
  edges: [],
};
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
      for (const item of doc.nodes.filter(ownsWords)) {
        expect(probe.paintOf(item.id), item.id).toEqual(modelLook(item));
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
