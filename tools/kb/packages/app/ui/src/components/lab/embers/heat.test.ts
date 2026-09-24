/**
 * Only contact heat may bloom (L2): whatever the resting glow's field does,
 * a resting sphere's emissive stays at or under 1 in every channel, for the
 * real accent of every design system in both variants. The accents are read
 * from the stylesheets, so a palette change, or a new design system, is
 * checked too.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { oklchToRgb } from "@/lib/css-color";
import { readDesignSystemSheets, type Variant } from "@/lib/design-system-sheets";
import { DESIGN_SYSTEM_IDS, type DesignSystemId } from "@/lib/theme";
import { HEAT_GAIN, RestCeiling, peakEmissive, peakShown, restCeiling, type Rgb } from "./heat";

const SRC = join(import.meta.dirname, "..", "..", "..");
const SHEETS = readDesignSystemSheets(readFileSync(join(SRC, "design-system.css"), "utf8"), (id) =>
  readFileSync(join(SRC, "design-systems", `${id}.css`), "utf8"),
);

/** An sRGB byte as a linear channel, as three stores a colour. */
function linear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** The lab accent (`--lab-accent`) of one design system and variant, as linear RGB. */
function accent(id: DesignSystemId, variant: Variant): Rgb {
  const value = SHEETS.resolve(id, variant, "--lab-accent");
  const srgb = oklchToRgb(value);
  if (srgb === null) throw new Error(`${id}/${variant}: --lab-accent is not oklch (${value})`);
  return [linear(srgb.r), linear(srgb.g), linear(srgb.b)];
}

/** Every appearance the lab can be shown in: each design system, light and dark. */
const THEMES = DESIGN_SYSTEM_IDS.flatMap((id) =>
  (["light", "dark"] as const).map((variant) => ({
    name: `${id} ${variant}`,
    accent: accent(id, variant),
    gain: HEAT_GAIN[variant],
  })),
);
const appearance = (name: string) => {
  const found = THEMES.find((t) => t.name === name);
  if (found === undefined) throw new Error(name);
  return found;
};

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

describe("the shown temperature across an appearance change", () => {
  const light = appearance("kb light");
  const dark = appearance("kb dark");
  const crossings = THEMES.flatMap((from) =>
    THEMES.filter((to) => to !== from).map((to) => [from, to] as const),
  );

  it("does not bloom on a frozen still switched to another appearance with no step", () => {
    // The sim is not stepping (reduced motion): the resting floor is whatever
    // it was before the switch, and the frame is shaded with the new curve.
    for (const to of THEMES) {
      for (let i = 0; i <= 40; i++) {
        const rest = (i / 40) * REST_MAX;
        expect(peakShown(to.accent, to.gain, 0, rest)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("does not bloom mid-ease, while the accent crosses between appearances", () => {
    for (const [from, to] of crossings) {
      for (const s of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const lerp = (c: 0 | 1 | 2) => from.accent[c] + (to.accent[c] - from.accent[c]) * s;
        const eased: Rgb = [lerp(0), lerp(1), lerp(2)];
        // The gain switches at once; the accent is still on its way.
        expect(peakShown(eased, to.gain, 0, REST_MAX)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("still lets saturated contact heat bloom past the cap, in every appearance", () => {
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
