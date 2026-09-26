/**
 * Only the hubs, the focus, the hover and search matches may bloom (L2). A
 * node can carry any stored colour — a tag's palette colour, a `sys.f.color`
 * taken verbatim, a `fixed:` colour, any `#rgb`/`#rrggbb`/`#rrggbbaa` from
 * the swatch editor — so the proof is over colour space, not a palette: at
 * rest, and under any lift, no fragment passes white, for the unit cube's
 * corners, every pure channel and a seeded spread of colours, under the ink
 * of every design system in both variants (read from the stylesheets), and
 * for every node look: the looks are the implementations, and the bloom rule
 * is their one contract. The shader caps a lift at each fragment's own
 * headroom; this checks the cap.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BLOOM_THRESHOLD, NUMBER_OPS } from "@/scene/shade-ops";
import { oklchToRgb } from "@/lib/css-color";
import { readDesignSystemSheets } from "@/lib/design-system-sheets";
import { TAG_PALETTE } from "@/lib/tag-color";
import { DESIGN_SYSTEM_IDS } from "@/lib/theme";
import { GLOW } from "./force3d-emphasis";
import { NODE_LOOKS, peakChannel, shadeNode, type NodeLighting, type Rgb } from "./force3d-light";

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

/** A token of one appearance, as the linear colour three holds. */
function tokenRgb(
  id: (typeof DESIGN_SYSTEM_IDS)[number],
  variant: "light" | "dark",
  token: string,
): Rgb {
  const srgb = oklchToRgb(SHEETS.resolve(id, variant, token));
  if (srgb === null) throw new Error(`${id}/${variant}: ${token} is not oklch`);
  return [linear(srgb.r / 255), linear(srgb.g / 255), linear(srgb.b / 255)];
}

/** Each appearance's ink and ground (`--foreground`, `--card`: the 3D palette's roles). */
const APPEARANCES = DESIGN_SYSTEM_IDS.flatMap((id) =>
  (["light", "dark"] as const).map((variant) => ({
    name: `${id} ${variant}`,
    ink: tokenRgb(id, variant, "--foreground"),
    ground: tokenRgb(id, variant, "--card"),
  })),
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

const lightings = (look: (typeof NODE_LOOKS)[number]): (NodeLighting & { name: string })[] =>
  APPEARANCES.map((a) => ({ ...a, look }));

describe.each(NODE_LOOKS)("3D light over every storable colour, %s look", (look) => {
  for (const lighting of lightings(look)) {
    it(`keeps a resting node, and any lift, at or under white in ${lighting.name}`, () => {
      for (const colour of COLOURS) {
        expect(peakChannel(colour, lighting, 0), `rest ${colour.join(",")}`).toBeLessThanOrEqual(
          BLOOM_THRESHOLD + 1e-9,
        );
        for (const lift of LIFTS) {
          expect(
            peakChannel(colour, lighting, 0, lift),
            `lift ${lift} ${colour.join(",")}`,
          ).toBeLessThanOrEqual(BLOOM_THRESHOLD + 1e-9);
        }
      }
    });
  }

  it("still lifts a colour with headroom: a lift is visible, not zeroed", () => {
    // Where the node faces the viewer, half lit: a fragment with headroom in every look.
    const grey: Rgb = [0.2, 0.2, 0.2];
    const facing = (lighting: NodeLighting, lift: number) =>
      shadeNode(
        NUMBER_OPS,
        {
          hue: grey,
          ground: lighting.ground,
          ink: lighting.ink,
          key: 0.5,
          rim: 0,
          presence: 1,
          glow: 0,
          lift,
        },
        lighting.look,
      )[0];
    for (const lighting of lightings(look))
      expect(facing(lighting, GLOW.rising)).toBeGreaterThan(facing(lighting, 0));
  });

  it("lets every hub of a tag colour bloom", () => {
    for (const lighting of lightings(look))
      for (const hex of TAG_PALETTE)
        expect(peakChannel(hexRgb(hex), lighting, GLOW.hub)).toBeGreaterThan(BLOOM_THRESHOLD);
  });
});
