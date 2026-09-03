import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { CANVAS_COLOR_PRESETS, resolveCanvasColor, canvasColorStyle } from "./canvas-color";

const indexCss = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index.css"),
  "utf8",
);

describe("canvas color presets", () => {
  test("presets 1–6 resolve to CSS custom properties", () => {
    for (const p of CANVAS_COLOR_PRESETS) {
      expect(resolveCanvasColor(p.id)).toBe(`var(--canvas-color-${p.id})`);
    }
  });

  test("hex and unknown strings pass through", () => {
    expect(resolveCanvasColor("#ff0000")).toBe("#ff0000");
    expect(resolveCanvasColor("rebeccapurple")).toBe("rebeccapurple");
    expect(resolveCanvasColor(undefined)).toBeUndefined();
  });

  test("index.css defines --canvas-color-1..6 under :root and .dark", () => {
    for (const id of ["1", "2", "3", "4", "5", "6"]) {
      const re = new RegExp(`--canvas-color-${id}:\\s*oklch\\(`);
      expect(indexCss.match(re)?.length).toBeGreaterThanOrEqual(1);
    }
    // both theme blocks carry the vars
    expect(indexCss).toMatch(
      /:root\s*\{[\s\S]*--canvas-color-1:[\s\S]*\}\s*\.dark\s*\{[\s\S]*--canvas-color-1:/,
    );
  });

  test("canvasColorStyle uses resolved var for border/fill", () => {
    const style = canvasColorStyle("3");
    expect(style.borderColor).toBe("var(--canvas-color-3)");
    expect(style.backgroundColor).toContain("var(--canvas-color-3)");
  });
});
