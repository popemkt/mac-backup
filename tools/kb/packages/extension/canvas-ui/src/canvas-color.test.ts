import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { CANVAS_PALETTE, styleOf, type CanvasEdge } from "@kb/canvas";
import { CANVAS_SWATCHES, paintCss } from "./canvas-color";

/** An edge in `color`, or in none. */
const edge = (color?: string): CanvasEdge => ({
  id: "e",
  fromNode: "a",
  toNode: "b",
  ...(color === undefined ? {} : { color }),
});

const designSystemCss = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../app/ui/src/design-system.css"),
  "utf8",
);

describe("the canvas palette", () => {
  test("each entry resolves to its CSS custom property", () => {
    for (const p of CANVAS_SWATCHES) {
      expect(paintCss(styleOf(edge(p.id)).color)).toBe(`var(--canvas-color-${p.id})`);
    }
  });

  test("hex and unknown strings pass through; none is none", () => {
    expect(paintCss(styleOf(edge("#ff0000")).color)).toBe("#ff0000");
    expect(paintCss(styleOf(edge("rebeccapurple")).color)).toBe("rebeccapurple");
    expect(paintCss(styleOf(edge()).color)).toBeUndefined();
    expect(paintCss(styleOf(edge(" ")).color)).toBeUndefined();
  });

  test("design-system.css defines every entry's token under :root and .dark", () => {
    for (const { id } of CANVAS_PALETTE) {
      const re = new RegExp(`--canvas-color-${id}:\\s*oklch\\(`, "g");
      expect(designSystemCss.match(re)?.length, id).toBe(2);
    }
    // both theme blocks carry the vars
    expect(designSystemCss).toMatch(
      /:root,[^{]*\{[\s\S]*--canvas-color-1:[\s\S]*\}\s*\.dark,[^{]*\{[\s\S]*--canvas-color-1:/,
    );
  });
});
