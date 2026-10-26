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
// is CSS only (gradients, patterns; artkit.ts has the shapes): nothing
// copyrighted is ever committed. A preset may also retune the motion itself
// (`tokens`, held to the style's budget by the tests) and recolor the shared
// effects (`paint`).
// A person's own image comes from the `artImage` setting, kept outside git,
// and each preset says where it goes; a preset must look finished without it.
//
// Each row links its section of the art direction (ART-DIRECTION.md: topic
// analysis, UI/UX concept, where it lives in source).
import { Schema } from "effect";
import { bracket, type Building, rect, skyline, tint, token, windows } from "./artkit.ts";
import type { EffectId } from "./effects.ts";
import type { MotionTokens } from "./motion.ts";
import type { Settings } from "./settings.ts";

/** One CSS background layer: an `<image>` (a gradient) and how it tiles. */
export interface ArtLayer {
  readonly image: string;
  readonly size?: string;
  readonly position?: string;
  readonly repeat?: string;
  readonly attachment?: "scroll" | "fixed";
}

/** Where art can paint: behind the open thread, or behind the sidebar. */
export const ART_SURFACES = ["backdrop", "sidebar"] as const;
export type ArtSurface = (typeof ART_SURFACES)[number];

export interface ArtSurfaceArt {
  /**
   * Topmost first, as in CSS `background`. Use the theme's colors through
   * `--lively-accent`, `--lively-accent-2`, `--lively-canvas`. Backdrop art
   * (and its mask) is anchored to the bottom-right corner in fixed pixels, not
   * percentages: bb's dock band (behind the composer) repeats the layers, reaching
   * the thread's corner (dom/reach.ts), and the two only meet seamlessly if neither
   * depends on the box's size.
   */
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
// The image is fixed to the window (background-attachment), so `size` and `position` are relative to the window.

export interface PresetArt {
  /**
   * Named colors the layers use as `var(--lively-c-<name>)`, each set once
   * under the preset: short layers, and one place to read a palette's own
   * art tokens (`--lively-art-<name>`, defined by its theme CSS) with a
   * fallback for any other theme.
   */
  readonly colors?: Readonly<Record<string, string>>;
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

/**
 * How the shared effects paint under a preset: the page wipe's panel (a
 * background and the mask that shapes it) and the chromatic split's two
 * colors. Unset, they are lively's own (ZZZ's slanted dotted panel, cyan and
 * magenta).
 */
export interface PresetPaint {
  /** The wipe's panel; `label` is printed across it in the preset's lettering, in `ink`. */
  readonly wipe?: { readonly fill: string; readonly mask: string; readonly label?: string; readonly ink?: string };
  readonly chroma?: readonly [string, string];
}

/**
 * The words lively itself prints under a preset, and their face: a caption
 * at the foot of the sidebar (art: it goes with the art switch), the page
 * wipe's label (PresetPaint), and an effect's own label (Turn()'s). Printed
 * as tracked capitals in `font` (a family stack, no files) and `color`.
 */
export interface PresetLettering {
  readonly font: string;
  readonly color: string;
  /** Set vertically down the sidebar's inner edge, in its gutter. */
  readonly sidebar?: string;
}

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
  /**
   * The preset's motion character: tokens laid over every (style, intensity)
   * at the full level (never under reduced motion), e.g. no overshoot for a
   * mechanical feel. They must keep the style's budget (motion.ts BUDGETS).
   */
  readonly tokens?: Partial<MotionTokens>;
  readonly paint?: PresetPaint;
  readonly lettering?: PresetLettering;
}

/** A soft accent, as a color-mix of the theme's accent. */
const accent = (percent: number, name = "--lively-accent") => `color-mix(in oklab, var(${name}) ${percent}%, transparent)`;

// Cloudbank (Transistor): the city at dusk. A far and a near skyline, the near one rimmed in
// Turn() cyan and lit with gold windows, under an ember-and-magenta horizon glow and a faint
// brush grain; in the sidebar, an Art Nouveau cartouche over a row of gold beads. Colors come
// from the palette's `--lively-art-*` tokens (themes/lively-cloudbank.css), else from the accent.
const CLOUDBANK_SPAN = 1800;
/** A color of the preset's art (PresetArt.colors). */
const c = (name: string) => `var(--lively-c-${name})`;
const farCity = skyline(7, CLOUDBANK_SPAN, { minW: 40, maxW: 92, minH: 54, maxH: 118, gap: 6 });
const nearCity = skyline(23, CLOUDBANK_SPAN, { minW: 26, maxW: 64, minH: 22, maxH: 86, gap: 34 });
/** Every third near building has a lit column or two. */
const litWindows = nearCity.flatMap((building: Building, index) =>
  index % 3 === 0 && building.height > 34
    ? [windows(c("lights"), building, 6, 10), ...(building.width > 40 ? [windows(c("lights"), building, building.width - 10, 16)] : [])]
    : [],
);
const CLOUDBANK_ART = {
  colors: {
    far: tint(token("--lively-art-far", "color-mix(in oklab, var(--lively-accent-2) 22%, var(--lively-canvas))"), 85),
    near: token("--lively-art-near", "color-mix(in oklab, #000 40%, var(--lively-canvas))"),
    rim: tint(token("--lively-art-rim", "var(--lively-accent)"), 70),
    lights: tint(token("--lively-art-lights", "var(--lively-accent-2)"), 70),
    ember: tint(token("--lively-art-sky-1", "var(--lively-accent-2)"), 42),
    dusk: tint(token("--lively-art-sky-2", "var(--lively-accent-2)"), 32),
    amber: tint(token("--lively-art-sky-3", "var(--lively-accent-2)"), 14),
    veil: tint(token("--lively-art-sky-2", "var(--lively-accent-2)"), 10),
    line: tint(token("--lively-art-line", "var(--lively-accent-2)"), 38),
    grain: tint("var(--ink, currentColor)", 3),
    sword: tint(token("--lively-art-sword", "var(--lively-accent)"), 80),
    swordGlow: tint(token("--lively-art-sword", "var(--lively-accent)"), 22),
  },
  backdrop: {
    layers: [
      ...litWindows,
      ...nearCity.map((building) => rect(c("rim"), building.right, building.height - 2, building.width, 2)),
      ...nearCity.map((building) => rect(c("near"), building.right, 0, building.width, building.height - 2)),
      ...farCity.map((building) => rect(c("far"), building.right, 0, building.width, building.height)),
      // The horizon: an ember glow, a magenta one to the left, a wide amber wash, in one fixed box.
      {
        image: [
          `radial-gradient(720px 240px at right 520px bottom 40px, ${c("ember")}, transparent 70%)`,
          `radial-gradient(620px 200px at right 1500px bottom 30px, ${c("dusk")}, transparent 70%)`,
        ].join(", "),
        size: `${CLOUDBANK_SPAN}px 700px`,
        position: "right bottom",
        repeat: "no-repeat",
      },
      {
        image: `radial-gradient(1400px 420px at right 900px bottom 0px, ${c("amber")}, transparent 72%)`,
        size: `${CLOUDBANK_SPAN}px 700px`,
        position: "right bottom",
        repeat: "no-repeat",
      },
      // Brush grain: two faint crossing hatches, as in a painted sky.
      { image: `repeating-linear-gradient(118deg, ${c("grain")} 0 1px, transparent 1px 9px)`, size: "180px 180px", position: "right bottom" },
    ],
    mask: "linear-gradient(to top, #000 0 300px, transparent 700px) right bottom / 6000px 700px no-repeat",
  },
  sidebar: {
    layers: [
      // The sword's light: a green-teal line down the sidebar's inner edge, with its glow.
      { image: `linear-gradient(to bottom, transparent, ${c("sword")} 18% 72%, transparent)`, size: "2px 100%", position: "right 0 top 0", repeat: "no-repeat" },
      { image: `linear-gradient(to left, ${c("swordGlow")}, transparent)`, size: "18px 100%", position: "right 0 top 0", repeat: "no-repeat" },
      // Two arcs of a cartouche, rising from the bottom edge, and a row of beads above them.
      { image: `radial-gradient(60% 100px at 50% 100%, transparent 0 94%, ${c("line")} 94% 96%, transparent 96%)`, size: "100% 110px", position: "center bottom", repeat: "no-repeat" },
      { image: `radial-gradient(44% 72px at 50% 100%, transparent 0 92%, ${c("line")} 92% 95%, transparent 95%)`, size: "100% 80px", position: "center bottom", repeat: "no-repeat" },
      { image: `radial-gradient(circle, ${c("line")} 1.2px, transparent 1.8px)`, size: "14px 14px", position: "center bottom 112px", repeat: "repeat-x" },
      { image: `linear-gradient(to top, ${c("veil")}, transparent)`, size: "100% 160px", position: "center bottom", repeat: "no-repeat" },
    ],
  },
  image: { surface: "backdrop", strength: 0.2, size: "cover", position: "center bottom" },
} as const satisfies PresetArt;

// YoRHa (NieR:Automata): a technical sheet. A fine and a coarse grid fading out from the
// lower right, a corner bracket with a rust marker, a tick ruler; hatching at the foot of the
// sidebar. Hairlines only, so text never sits on anything heavier than 8% ink.
const YORHA_ART = {
  colors: {
    line: token("--lively-art-line", "var(--lively-accent)"),
    mark: tint(token("--lively-art-mark", "var(--lively-accent)"), 70),
    rim: token("--lively-art-rim", "var(--lively-accent-2)"),
  },
  backdrop: {
    layers: [
      ...bracket(c("mark"), 18, 18, 26, 2),
      rect(c("rim"), 52, 18, 6, 6),
      { image: `repeating-linear-gradient(to left, ${tint(c("line"), 30)} 0 1px, transparent 1px 12px)`, size: "960px 5px", position: "right 18px bottom 8px", repeat: "no-repeat" },
      { image: `linear-gradient(to left, ${tint(c("line"), 10)} 1px, transparent 1px)`, size: "120px 120px", position: "right bottom" },
      { image: `linear-gradient(to top, ${tint(c("line"), 10)} 1px, transparent 1px)`, size: "120px 120px", position: "right bottom" },
      { image: `linear-gradient(to left, ${tint(c("line"), 6)} 1px, transparent 1px)`, size: "24px 24px", position: "right bottom" },
      { image: `linear-gradient(to top, ${tint(c("line"), 6)} 1px, transparent 1px)`, size: "24px 24px", position: "right bottom" },
    ],
    mask: "radial-gradient(farthest-corner at 100% 100%, #000 12%, transparent 78%) right bottom / 1400px 1000px no-repeat",
  },
  sidebar: {
    layers: [
      { image: `repeating-linear-gradient(-45deg, ${tint(c("line"), 12)} 0 1px, transparent 1px 7px)` },
      { image: `linear-gradient(${tint(c("line"), 35)}, ${tint(c("line"), 35)})`, size: "calc(100% - 24px) 1px", position: "center bottom 96px", repeat: "no-repeat" },
    ],
    mask: "linear-gradient(to top, #000, transparent 96px)",
  },
  image: { surface: "backdrop", strength: 0.12, size: "cover", position: "center" },
} as const satisfies PresetArt;

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
            size: "900px 760px",
            position: "right bottom",
            repeat: "no-repeat",
          },
          { image: `radial-gradient(circle, ${accent(22)} 1.1px, transparent 1.7px)`, size: "10px 10px", position: "right bottom" },
        ],
        mask: "radial-gradient(farthest-corner at 100% 100%, #000 8%, transparent 68%) right bottom / 900px 760px no-repeat",
      },
      // Hazard stripes along the bottom of the sidebar.
      sidebar: {
        layers: [{ image: `repeating-linear-gradient(-55deg, ${accent(9)} 0 7px, transparent 7px 16px)` }],
        mask: "linear-gradient(to top, #000, transparent 26%)",
      },
      image: { surface: "backdrop", strength: 0.22, size: "cover", position: "right bottom" },
    },
  },
  {
    id: "cloudbank",
    label: "Cloudbank",
    description:
      "After Transistor: a gliding clean spring, the sword's teal light, a Turn() freeze with its segmented bar while an agent waits for you, the Process whitewashing the thread into cells as you Jaunt() to another, functions written as calls, the Lively Cloudbank palette, and a dusk skyline behind the thread.",
    artDirection: "ART-DIRECTION.md#cloudbank",
    values: { intensity: "lively", style: "clean", stickers: "off", effects: { pageWipe: true, turnFreeze: true } },
    palette: "lively-cloudbank",
    art: CLOUDBANK_ART,
    // A clean 1920s sans for reading, as kb's Transistor (Jost, OFL, if installed), then system
    // geometric faces. No font file ships: lively has no way to serve one yet (GAP [[01M5SK4NQ90CRG9YAQC2GXNZJW]]).
    fonts: { sans: 'Jost, "Avenir Next", Futura, "Century Gothic", ui-sans-serif, system-ui, sans-serif' },
    // The sword's light runs brighter: every accent glow (focus, working line, rings) is stronger.
    tokens: { glow: 0.34 },
    // Functions written as calls, in tracked geometric capitals and an OVC terminal's amber.
    lettering: {
      font: '"Josefin Sans", Futura, "Avenir Next", "Century Gothic", sans-serif',
      color: "var(--lively-accent-2)",
      sidebar: "Crash()   Breach()   Jaunt()   Load()   Spark()",
    },
    paint: {
      // The Process: the thread whitewashes into blank cells as you jump (Jaunt()) to another.
      wipe: {
        fill: "linear-gradient(90deg, color-mix(in oklab, var(--lively-accent) 30%, transparent) 1px, transparent 1px) 0 0 / 16px 16px, linear-gradient(color-mix(in oklab, var(--lively-accent) 30%, transparent) 1px, transparent 1px) 0 0 / 16px 16px, var(--lively-art-process, #f2efe6)",
        mask: "linear-gradient(90deg, transparent 0 12%, rgb(0 0 0 / 0.3) 12% 15%, rgb(0 0 0 / 0.65) 15% 18%, #000 18% 82%, rgb(0 0 0 / 0.65) 82% 85%, rgb(0 0 0 / 0.3) 85% 88%, transparent 88%)",
        label: "Jaunt()",
        ink: "#1b1d36",
      },
      chroma: ["var(--lively-accent)", "var(--lively-art-sky-1, var(--destructive, #e8503a))"],
    },
  },
  {
    id: "yorha",
    label: "YoRHa",
    description:
      "After NieR:Automata: mechanical motion (snappy, clean, never past its target, no blur), square corners, a scan-bar wipe between threads, a glitch when a thread fails, the Lively YoRHa palette, and a technical grid behind the thread.",
    artDirection: "ART-DIRECTION.md#yorha",
    values: { intensity: "lively", style: "clean", stickers: "off", speed: "snappy", effects: { pageWipe: true, glitch: true } },
    palette: "lively-yorha",
    art: YORHA_ART,
    fonts: { sans: '"Helvetica Neue", Helvetica, "Nimbus Sans", Arial, ui-sans-serif, system-ui, sans-serif' },
    tokens: { overshoot: 0, blur: 0, tilt: 0, liftShadow: 0 },
    paint: {
      wipe: {
        fill: "repeating-linear-gradient(0deg, var(--lively-art-line, var(--lively-accent)) 0 6px, color-mix(in oklab, var(--lively-art-line, var(--lively-accent)) 55%, transparent) 6px 7px, transparent 7px 12px)",
        mask: "linear-gradient(90deg, transparent 10%, #000 22% 78%, transparent 90%)",
      },
      chroma: ["var(--lively-art-rim, var(--lively-accent-2))", "#4a7a8c"],
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
