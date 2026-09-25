/**
 * Only the hubs, the focus, the hover and search matches may bloom (L2). A
 * node can carry any stored colour — a tag's palette colour, a `sys.f.color`
 * taken verbatim, a `fixed:` colour, any `#rgb`/`#rrggbb`/`#rrggbbaa` from
 * the swatch editor — so the proof is over colour space, not a palette: at
 * rest, and under any lift, no fragment passes white, for the unit cube's
 * corners, every pure channel and a seeded spread of colours, under the ink
 * of every design system in both variants (read from the stylesheets). The
 * shader caps a lift at each fragment's own headroom; this checks the cap.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { oklchToRgb } from "@/lib/css-color";
import { readDesignSystemSheets } from "@/lib/design-system-sheets";
import { TAG_PALETTE } from "@/lib/tag-color";
import { DESIGN_SYSTEM_IDS } from "@/lib/theme";
import { GLOW } from "./force3d-emphasis";
import { peakChannel, type Rgb } from "./force3d-light";

const SRC = join(import.meta.dirname, "..", "..");
const SHEETS = readDesignSystemSheets(readFileSync(join(SRC, "design-system.css"), "utf8"), (id) =>
  readFileSync(join(SRC, "design-systems", `${id}.css`), "utf8"),
);

/** An sRGB channel (0–1) as a linear one, as three stores a colour. */
function linear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function hexRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [linear(((n >> 16) & 255) / 255), linear(((n >> 8) & 255) / 255), linear((n & 255) / 255)];
}

/** Each appearance's ink (`--foreground`, the 3D palette's ink role). */
const INKS = DESIGN_SYSTEM_IDS.flatMap((id) =>
  (["light", "dark"] as const).map((variant) => {
    const srgb = oklchToRgb(SHEETS.resolve(id, variant, "--foreground"));
    if (srgb === null) throw new Error(`${id}/${variant}: --foreground is not oklch`);
    const ink: Rgb = [linear(srgb.r / 255), linear(srgb.g / 255), linear(srgb.b / 255)];
    return { name: `${id} ${variant}`, ink };
  }),
);

/** The unit cube's corners (every pure channel and mix of full channels) … */
const CORNERS: Rgb[] = [0, 1].flatMap((r) =>
  [0, 1].flatMap((g) => [0, 1].map((b): Rgb => [r, g, b])),
);
/** … the reviewer's crossing colours, and a seeded spread of the rest. */
const NAMED: Rgb[] = ["#0000ff", "#ff0000", "#00ffff", "#ffffff", "#ff00aa", "#ff00ff"].map(hexRgb);
let seed = 17;
const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const SPREAD: Rgb[] = Array.from({ length: 64 }, (): Rgb => [random(), random(), random()]);
const COLOURS: Rgb[] = [...CORNERS, ...NAMED, ...SPREAD, ...TAG_PALETTE.map(hexRgb)];

/** Lifts to try: the two roles', and far past them (the cap must hold whatever the value). */
const LIFTS = [GLOW.rising, GLOW.neighbour, 0.5, 1, 4];

describe("3D light over every storable colour", () => {
  for (const { name, ink } of INKS) {
    it(`keeps a resting node, and any lift, at or under white in ${name}`, () => {
      for (const colour of COLOURS) {
        expect(peakChannel(colour, ink, 0), `rest ${colour.join(",")}`).toBeLessThanOrEqual(
          1 + 1e-9,
        );
        for (const lift of LIFTS) {
          expect(
            peakChannel(colour, ink, 0, lift),
            `lift ${lift} ${colour.join(",")}`,
          ).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    });
  }

  it("still lifts a colour with headroom: a lift is visible, not zeroed", () => {
    const grey: Rgb = [0.2, 0.2, 0.2];
    for (const { ink } of INKS)
      expect(peakChannel(grey, ink, 0, GLOW.rising)).toBeGreaterThan(peakChannel(grey, ink, 0));
  });

  it("lets every hub of a tag colour bloom", () => {
    for (const { ink } of INKS)
      for (const hex of TAG_PALETTE)
        expect(peakChannel(hexRgb(hex), ink, GLOW.hub)).toBeGreaterThan(1);
  });
});
