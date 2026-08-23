import { describe, expect, it } from "vitest";
import { oklchToRgb, toRenderableColor } from "./css-color";

/**
 * These guard the 3D renderer: `three-render-objects` parses colors with
 * `polished`, which throws on anything but hex/rgb/rgba/hsl/hsla. An oklch
 * token reaching it left the whole scene blank.
 */
const POLISHED_RGB = /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/;
const POLISHED_RGBA =
  /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*[\d.]+\s*\)$/;

describe("oklchToRgb", () => {
  it("converts the achromatic ends of the token ramp", () => {
    expect(oklchToRgb("oklch(1 0 0)")).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(oklchToRgb("oklch(0 0 0)")).toMatchObject({ r: 0, g: 0, b: 0 });
  });

  it("round-trips a chromatic token close to its sRGB original", () => {
    // oklch(0.62 0.15 145) is the authored canvas green.
    const rgb = oklchToRgb("oklch(0.62 0.15 145)");
    expect(rgb).not.toBeNull();
    expect(rgb!.g).toBeGreaterThan(rgb!.r);
    expect(rgb!.g).toBeGreaterThan(rgb!.b);
    for (const channel of [rgb!.r, rgb!.g, rgb!.b]) {
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
    expect(rgb).not.toBeNull();
    for (const channel of [rgb!.r, rgb!.g, rgb!.b]) {
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
      expect(out, input).not.toBeNull();
      expect(out!, input).toMatch(
        out!.startsWith("rgba") ? POLISHED_RGBA : POLISHED_RGB,
      );
    }
  });

  it("never emits fractional channels, which polished rejects", () => {
    // Chrome serializes computed rgb with decimals in some paths.
    const out = toRenderableColor("rgb(12.5 34.4 56.6)");
    expect(out).toBe("rgb(13, 34, 57)");
  });

  it("applies an alpha override to an oklch token — the bug that silently dropped it", () => {
    expect(toRenderableColor("oklch(0.98 0 0)", 0.25)).toMatch(POLISHED_RGBA);
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
