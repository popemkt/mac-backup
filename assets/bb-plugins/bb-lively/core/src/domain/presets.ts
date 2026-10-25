// Presets: one art direction each, a row in one table. A preset sets any
// number of settings at once (motion, intensity, style, the style's options,
// speed, the art layer, any effect switch), names the host palette (theme)
// that goes with it, and may carry an art layer and font tokens. Every field a
// person leaves on "From preset" follows the active preset; an explicit
// setting always wins (resolve.ts). The art and fonts are painted by lively's
// own stylesheet under `:root[data-lively-preset="<id>"]` (dom/stylesheet.ts),
// so look and motion switch together.
//
// Adding a preset: one row here, its palette's CSS file and manifest entry
// (the host registers palettes; bb's are `bb.themes` in package.json), and any
// effect of its own registered in effects.ts with `presets: ["<id>"]`. Art
// is CSS only (gradients, patterns): nothing copyrighted is ever committed.
// A person's own image comes from the `artImage` setting, kept outside git,
// and each preset says where it goes; a preset must look finished without it.
//
// Each row links its section of the art direction (topic analysis, UI/UX
// concept, where it lives in source).
// TODO(art-direction): ART-DIRECTION.md is being written on another branch;
// the `artDirection` anchors below point at its sections once it lands.
import { Schema } from "effect";
import type { EffectId } from "./effects.ts";
import type { Settings } from "./settings.ts";

/** One CSS background layer: an `<image>` (a gradient) and how it tiles. */
export interface ArtLayer {
  readonly image: string;
  readonly size?: string;
  readonly position?: string;
  readonly repeat?: string;
}

/** Where art can paint: behind the open thread, or behind the sidebar. */
export const ART_SURFACES = ["backdrop", "sidebar"] as const;
export type ArtSurface = (typeof ART_SURFACES)[number];

export interface ArtSurfaceArt {
  /** Topmost first, as in CSS `background`. Use the theme's colors through `--lively-accent`, `--lively-accent-2`, `--lively-canvas`. */
  readonly layers: ReadonlyArray<ArtLayer>;
  /** A CSS mask over the whole surface's art (the person's image too), to keep it off where text sits. */
  readonly mask?: string;
}

/** Where the person's own art image goes, and how strongly it shows (0–1; the rest is washed out by the canvas color). */
export interface ArtImagePlacement {
  readonly surface: ArtSurface;
  readonly strength: number;
  readonly size: string;
  readonly position: string;
}

/** The placement for a preset that does not name one. */
export const DEFAULT_IMAGE_PLACEMENT: ArtImagePlacement = { surface: "backdrop", strength: 0.16, size: "cover", position: "center" };

export interface PresetArt {
  readonly backdrop?: ArtSurfaceArt;
  readonly sidebar?: ArtSurfaceArt;
  readonly image?: ArtImagePlacement;
}

/** Font stacks (families only: no font file is committed); they override the host's own font tokens. */
export interface PresetFonts {
  readonly sans?: string;
  readonly mono?: string;
}

/** The settings a preset may set: any presettable field, and any effect switch. */
export type PresetValues = Partial<Omit<Settings, "preset" | "palette" | "artImage" | "effects">> & {
  readonly effects?: Partial<Readonly<Record<EffectId, boolean>>>;
};

export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Its section of the art direction (ART-DIRECTION.md, relative to the plugin). */
  readonly artDirection?: string;
  readonly values: PresetValues;
  /** The host palette (theme) that goes with it; bb's id is `plugin:bb-lively:<palette>`. */
  readonly palette?: string;
  readonly art?: PresetArt;
  readonly fonts?: PresetFonts;
}

/** A soft accent, as a color-mix of the theme's accent. */
const accent = (percent: number, token = "--lively-accent") => `color-mix(in oklab, var(${token}) ${percent}%, transparent)`;

export const PRESETS = [
  {
    id: "custom",
    label: "Custom",
    description: "No preset: every setting is its own default until you change it.",
    values: {},
  },
  {
    id: "calm",
    label: "Calm",
    description: "Quiet and quick: subtle, clean motion, no sticker shadows, no page wipe. Leaves bb's theme alone.",
    artDirection: "ART-DIRECTION.md#calm",
    values: { intensity: "subtle", style: "clean", stickers: "off", effects: { pageWipe: false } },
  },
  {
    id: "lively",
    label: "Lively",
    description: "Clean motion at the lively volume (one soft overshoot, a little glow), on the Lively palette.",
    artDirection: "ART-DIRECTION.md#lively",
    values: { intensity: "lively", style: "clean" },
    palette: "lively",
  },
  {
    id: "zzz",
    label: "ZZZ",
    description:
      "After Zenless Zone Zero: wobbly at bold, skewing rows, sticker shadows, matched jelly, the page wipe, the Lively ZZZ palette, and a halftone-and-slash backdrop.",
    artDirection: "ART-DIRECTION.md#zzz",
    values: { intensity: "bold", style: "wobbly", skew: true, stickers: "wobbly", jelly: "matched", effects: { pageWipe: true } },
    palette: "lively-zzz",
    art: {
      // ZZZ's panels: a halftone field and two accent slashes rising out of the lower right.
      backdrop: {
        layers: [
          {
            image: `linear-gradient(112deg, transparent 0 74%, ${accent(9)} 74% 81%, transparent 81% 83.5%, ${accent(8, "--lively-accent-2")} 83.5% 85%, transparent 85%)`,
          },
          { image: `radial-gradient(circle, ${accent(22)} 1.1px, transparent 1.7px)`, size: "10px 10px" },
        ],
        mask: "radial-gradient(130% 110% at 100% 100%, #000 8%, transparent 68%)",
      },
      // Hazard stripes along the bottom of the sidebar.
      sidebar: {
        layers: [{ image: `repeating-linear-gradient(-55deg, ${accent(9)} 0 7px, transparent 7px 16px)` }],
        mask: "linear-gradient(to top, #000, transparent 26%)",
      },
      image: { surface: "backdrop", strength: 0.22, size: "cover", position: "right bottom" },
    },
  },
] as const satisfies ReadonlyArray<Preset>;

export type PresetId = (typeof PRESETS)[number]["id"];
export const PRESET_IDS = PRESETS.map((preset) => preset.id) as unknown as readonly [PresetId, ...Array<PresetId>];
export const PresetId = Schema.Literals(PRESET_IDS);

/** A preset by id; the first row (custom) for an id the table does not have. */
export function presetById(id: string, presets: ReadonlyArray<Preset> = PRESETS): Preset {
  return presets.find((preset) => preset.id === id) ?? (presets[0] as Preset);
}
