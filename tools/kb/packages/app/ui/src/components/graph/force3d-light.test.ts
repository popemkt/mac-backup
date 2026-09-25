/**
 * Only the hubs, the focus, the hover and search matches may bloom (L2): the
 * unprompted tiers below them — the rising nodes and a focus's neighbours —
 * must stay at or under 1 for every node colour the graph paints, under the
 * ink of every design system in both variants. The ink is read from the
 * stylesheets, so a palette change or a new design system is checked too.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { oklchToRgb, toRenderableColor } from "@/lib/css-color";
import { readDesignSystemSheets } from "@/lib/design-system-sheets";
import { TAG_PALETTE } from "@/lib/tag-color";
import { DESIGN_SYSTEM_IDS } from "@/lib/theme";
import { GLOW } from "./force3d-emphasis";
import { glowHeadroom, peakChannel, type Rgb } from "./force3d-light";

const SRC = join(import.meta.dirname, "..", "..");
const SHEETS = readDesignSystemSheets(readFileSync(join(SRC, "design-system.css"), "utf8"), (id) =>
  readFileSync(join(SRC, "design-systems", `${id}.css`), "utf8"),
);

/** An sRGB byte as a linear channel, as three stores a colour. */
function linear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgbOf(color: string): Rgb {
  const srgb = oklchToRgb(color);
  const parsed =
    srgb ??
    (() => {
      const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(toRenderableColor(color) ?? "");
      return m ? { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) } : null;
    })();
  if (parsed === null) throw new Error(`unreadable colour ${color}`);
  return [linear(parsed.r), linear(parsed.g), linear(parsed.b)];
}

/** Each appearance's ink (`--foreground`, the 3D palette's ink role). */
const INKS = DESIGN_SYSTEM_IDS.flatMap((id) =>
  (["light", "dark"] as const).map((variant) => ({
    name: `${id} ${variant}`,
    ink: rgbOf(SHEETS.resolve(id, variant, "--foreground")),
  })),
);
const HUES = TAG_PALETTE.map((hex) => ({ hex, rgb: rgbOf(hex) }));

/** The least headroom any node colour has under any appearance's ink. */
const HEADROOM = Math.min(
  ...INKS.flatMap(({ ink }) => HUES.map(({ rgb }) => glowHeadroom(rgb, ink))),
);

describe("3D glow tiers", () => {
  for (const { name, ink } of INKS) {
    it(`keeps the rising tier and neighbours under the bloom threshold in ${name}`, () => {
      for (const { hex, rgb } of HUES) {
        expect(peakChannel(rgb, ink, GLOW.rising), `${hex} rising`).toBeLessThanOrEqual(1);
        expect(peakChannel(rgb, ink, GLOW.neighbour), `${hex} neighbour`).toBeLessThanOrEqual(1);
      }
    });
  }

  it("leaves those tiers inside the computed headroom, and a hub well past it", () => {
    expect(GLOW.rising).toBeLessThanOrEqual(HEADROOM);
    expect(GLOW.neighbour).toBeLessThanOrEqual(HEADROOM);
    // Something is still left to see: a lift, not nothing.
    expect(GLOW.rising).toBeGreaterThan(0);
    // Every hub crosses, whatever its colour: it blooms.
    for (const { ink } of INKS)
      for (const { rgb } of HUES) expect(peakChannel(rgb, ink, GLOW.hub)).toBeGreaterThan(1);
  });

  it("keeps a resting node matte: no glow never blooms", () => {
    for (const { ink } of INKS)
      for (const { hex, rgb } of HUES) expect(peakChannel(rgb, ink, 0), hex).toBeLessThanOrEqual(1);
  });

  it("bounds glowHeadroom exactly: at the headroom a channel reaches 1", () => {
    const { rgb } = HUES[0] ?? { rgb: [1, 0, 0] as Rgb };
    const ink = INKS[0]?.ink ?? ([0, 0, 0] as Rgb);
    expect(peakChannel(rgb, ink, glowHeadroom(rgb, ink))).toBeCloseTo(1, 9);
  });

  it("reports the headroom", () => {
    console.log(`3D glow headroom: ${HEADROOM.toFixed(4)}`);
    expect(HEADROOM).toBeGreaterThan(0);
  });
});
