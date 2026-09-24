/**
 * Only contact heat may bloom (L2): whatever the resting glow's field does,
 * a resting sphere's emissive stays at or under 1 in every channel, for both
 * themes' real accents. The accents are read from the stylesheet, so a
 * palette change is checked too.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { oklchToRgb } from "@/lib/css-color";
import { HEAT_GAIN, peakEmissive, restCeiling, type Rgb } from "./heat";

const INDEX_CSS = readFileSync(join(import.meta.dirname, "..", "..", "..", "index.css"), "utf8");

/** An sRGB byte as a linear channel, as three stores a colour. */
function linear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** `--primary` (the lab accent) in the `:root` or `.dark` block, as linear RGB. */
function accent(block: ":root" | ".dark"): Rgb {
  const body =
    new RegExp(`${block.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(INDEX_CSS)?.[1] ?? "";
  const value = /--primary:\s*([^;]+);/.exec(body)?.[1] ?? "";
  const srgb = oklchToRgb(value);
  if (srgb === null) throw new Error(`no --primary in ${block}`);
  return [linear(srgb.r), linear(srgb.g), linear(srgb.b)];
}

const THEMES = [
  { name: "light", accent: accent(":root"), gain: HEAT_GAIN.light },
  { name: "dark", accent: accent(".dark"), gain: HEAT_GAIN.dark },
] as const;

describe("the resting glow", () => {
  for (const theme of THEMES) {
    it(`never blooms in the ${theme.name} theme`, () => {
      const ceiling = restCeiling(theme.accent, theme.gain);
      let peak = 0;
      for (let i = 0; i <= 400; i++) {
        peak = Math.max(peak, peakEmissive(theme.accent, theme.gain, (i / 400) * ceiling));
      }
      expect(peak).toBeLessThanOrEqual(1);
      // …and is still a warm rest, not a floor pushed down to nothing.
      expect(ceiling).toBeGreaterThan(0.35);
    });

    it(`leaves contact heat free to cross the threshold in the ${theme.name} theme`, () => {
      expect(peakEmissive(theme.accent, theme.gain, 1)).toBeGreaterThan(1);
    });
  }
});
