import { describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { oklchToRgb, toRenderableColor } from "./css-color";

/**
 * Canvas consumers parse only hex and integer `rgb()`/`rgba()` (the strict
 * shape these patterns pin), so every token must arrive in it.
 */
const STRICT_RGB = /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/;
const STRICT_RGBA = /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*[\d.]+\s*\)$/;

describe("oklchToRgb", () => {
  it("converts the achromatic ends of the token ramp", () => {
    expect(oklchToRgb("oklch(1 0 0)")).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(oklchToRgb("oklch(0 0 0)")).toMatchObject({ r: 0, g: 0, b: 0 });
  });

  it("round-trips a chromatic token close to its sRGB original", () => {
    // oklch(0.62 0.15 145) is the authored canvas green.
    const rgb = oklchToRgb("oklch(0.62 0.15 145)");
    const color = present(rgb, "oklch rgb");
    expect(color.g).toBeGreaterThan(color.r);
    expect(color.g).toBeGreaterThan(color.b);
    for (const channel of [color.r, color.g, color.b]) {
      expect(Number.isInteger(channel)).toBe(true);
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });

  it("accepts percentage lightness, slash alpha, and `none`", () => {
    expect(oklchToRgb("oklch(100% 0 0)")).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(oklchToRgb("oklch(0.5 0.1 200 / 0.4)")?.alpha).toBe(0.4);
    expect(oklchToRgb("oklch(0.5 none none)")).not.toBeNull();
  });

  it("clamps out-of-gamut conversions into byte range", () => {
    const rgb = oklchToRgb("oklch(0.9 0.4 20)");
    const color = present(rgb, "oklch rgb");
    for (const channel of [color.r, color.g, color.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });

  it("returns null for non-oklch input", () => {
    expect(oklchToRgb("rgb(1, 2, 3)")).toBeNull();
    expect(oklchToRgb("#ef4444")).toBeNull();
    expect(oklchToRgb("nonsense")).toBeNull();
  });
});

describe("toRenderableColor", () => {
  it("emits only shapes polished can parse", () => {
    for (const input of [
      "oklch(0.98 0 0)",
      "oklch(0.21 0.01 250)",
      "rgb(12, 34, 56)",
      "rgba(12, 34, 56, 0.5)",
      "#ef4444",
      "#fff",
    ]) {
      const out = toRenderableColor(input);
      const color = present(out, "renderable color");
      expect(color, input).toMatch(color.startsWith("rgba") ? STRICT_RGBA : STRICT_RGB);
    }
  });

  it("never emits fractional channels, which polished rejects", () => {
    // Chrome serializes computed rgb with decimals in some paths.
    const out = toRenderableColor("rgb(12.5 34.4 56.6)");
    expect(out).toBe("rgb(13, 34, 57)");
  });

  it("applies an alpha override to an oklch token — the bug that silently dropped it", () => {
    expect(toRenderableColor("oklch(0.98 0 0)", 0.25)).toMatch(STRICT_RGBA);
    expect(toRenderableColor("oklch(0.98 0 0)", 0.25)).toContain(", 0.25)");
  });

  it("treats alpha >= 1 as opaque rgb", () => {
    expect(toRenderableColor("oklch(1 0 0)", 1)).toBe("rgb(255, 255, 255)");
  });

  it("returns null for input it cannot parse", () => {
    expect(toRenderableColor("color(display-p3 1 0 0)")).toBeNull();
    expect(toRenderableColor("rebeccapurple")).toBeNull();
  });
});
