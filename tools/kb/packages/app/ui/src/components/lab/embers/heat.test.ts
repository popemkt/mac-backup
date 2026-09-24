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
import { HEAT_GAIN, RestCeiling, peakEmissive, peakShown, restCeiling, type Rgb } from "./heat";

const DESIGN_SYSTEM_CSS = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "design-system.css"),
  "utf8",
);

/** An sRGB byte as a linear channel, as three stores a colour. */
function linear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** `--primary` (the lab accent) in the `:root` or `.dark` block, as linear RGB. */
function accent(block: ":root" | ".dark"): Rgb {
  const body =
    new RegExp(`${block.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(DESIGN_SYSTEM_CSS)?.[1] ?? "";
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

/** The warmest the resting floor ever is (`restFloor`: 0.5 plus 0.14 of noise). */
const REST_MAX = 0.64;

describe("the shown temperature across a theme change", () => {
  const [light, dark] = THEMES;

  it("does not bloom on a frozen still switched from light to dark with no step", () => {
    // The sim is not stepping (reduced motion): the resting floor is whatever
    // it was in the light theme, and the frame is shaded with the dark curve.
    for (let i = 0; i <= 40; i++) {
      const rest = (i / 40) * REST_MAX;
      expect(peakShown(dark.accent, dark.gain, 0, rest)).toBeLessThanOrEqual(1);
    }
    expect(peakShown(light.accent, light.gain, 0, REST_MAX)).toBeLessThanOrEqual(1);
  });

  it("does not bloom mid-ease, while the accent crosses between the themes", () => {
    for (const [from, to] of [
      [dark, light],
      [light, dark],
    ] as const) {
      for (const s of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const lerp = (c: 0 | 1 | 2) => from.accent[c] + (to.accent[c] - from.accent[c]) * s;
        const eased: Rgb = [lerp(0), lerp(1), lerp(2)];
        // The gain switches at once; the accent is still on its way.
        expect(peakShown(eased, to.gain, 0, REST_MAX)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("still lets saturated contact heat bloom past the cap, in both themes", () => {
    // The cap bounds the resting glow only: a sphere at the pop threshold is
    // shown hot even where the rest is at its warmest.
    for (const theme of THEMES) {
      expect(peakShown(theme.accent, theme.gain, 1, REST_MAX)).toBeGreaterThan(1);
      expect(peakShown(theme.accent, theme.gain, 1, 0)).toBeGreaterThan(1);
    }
  });

  it("solves again only when the accent or gain moved", () => {
    const ceilings = new RestCeiling();
    const [r, g, b] = dark.accent;
    const first = ceilings.for({ r, g, b }, dark.gain);
    expect(ceilings.for({ r, g, b }, dark.gain)).toBe(first);
    expect(ceilings.for({ r, g, b }, light.gain)).not.toBe(first);
  });
});
