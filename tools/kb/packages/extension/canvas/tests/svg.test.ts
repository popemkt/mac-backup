/**
 * The SVG export stands alone (DESIGN.md → Canvas documents → Export): every
 * design token its painting says is given a value by the file's own
 * `<style>`, for every palette colour, size and font, so it renders outside
 * kb. What it paints is held to the projections by the look contract
 * (`canvas-ui` `canvas-look.contract.test.tsx`).
 */
import { describe, expect, test } from "bun:test";
import {
  CANVAS_FONTS,
  CANVAS_PALETTE,
  CANVAS_SIZES,
  canvasSvg,
  type CanvasDoc,
  type CanvasNode,
} from "../src/index.ts";

const items: CanvasNode[] = CANVAS_PALETTE.flatMap(({ id }, i) =>
  CANVAS_SIZES.map((size, j) => ({
    id: `t-${id}-${size}`,
    type: "text" as const,
    text: "words",
    x: i * 200,
    y: j * 100,
    width: 180,
    height: 80,
    color: id,
    style: { size, font: CANVAS_FONTS[j % CANVAS_FONTS.length], fill: "solid" as const },
  })),
);
const doc: CanvasDoc = {
  nodes: [
    ...items,
    { id: "k", type: "kb-node", nodeId: "n", x: 0, y: -200, width: 100, height: 60 },
  ],
  edges: [{ id: "e", fromNode: items[0]?.id ?? "", toNode: "k", label: "l", color: "2" }],
};

describe("canvasSvg", () => {
  test("defines every token it paints with in its own style", () => {
    const svg = canvasSvg(doc, { textOf: () => "card", bound: () => true });
    const rule = /<style>svg \{([^}]*)\}<\/style>/.exec(svg)?.[1] ?? "";
    const defined = new Set([...rule.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
    const used = new Set([...svg.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(10);
    expect([...used].filter((token) => !defined.has(token))).toEqual([]);
  });

  test("an empty canvas is an empty drawing with its margin", () => {
    const svg = canvasSvg({ nodes: [], edges: [] }, { textOf: () => undefined, bound: () => true });
    expect(svg).toContain('viewBox="0 0 48 48"');
    expect(svg).not.toContain("data-card-id");
  });
});
