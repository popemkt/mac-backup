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
import { bar, bracket, type Building, corners, rect, skyline, tint, token, windows } from "./artkit.ts";
import type { EffectId } from "./effects.ts";
import type { MotionTokens } from "./motion.ts";
import type { SendForm } from "./send.ts";
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

/**
 * The host roles a preset's skin can dress (dom/targets.ts names their selectors): the composer and
 * its send button, the person's own messages, the thread's title and header, the side panel, the
 * empty page a new thread starts on, menus and dialogs.
 */
export const SKIN_TARGETS = ["focusBox", "sendButton", "sentRow", "threadTitle", "pageHeader", "sidePanel", "composeHome", "overlayOpen", "dialogOpen"] as const;
export type SkinTarget = (typeof SKIN_TARGETS)[number];

/**
 * A preset's dress for one host role: paint, at rest, so it holds with every effect (and motion) off.
 * Declarations only (borders, backgrounds, type, a decoration); nothing that animates, and nothing
 * that moves the host's layout but a label of the preset's own (`before`).
 */
export interface SkinRule {
  /** Declarations on the element itself. */
  readonly style?: string;
  /** Background layers on the element itself, topmost first (its own background color stays). */
  readonly layers?: ReadonlyArray<ArtLayer>;
  /**
   * Declarations on its `::before` (give it `content`). Only on a role lively draws no `::before`
   * of its own on under this preset (tests/art.test.ts holds Control's to it).
   */
  readonly before?: string;
  /** The same on its `::after`. */
  readonly after?: string;
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
  /** The preset's dress for bb's own controls and surfaces, keyed by role (art: it goes with the art switch). */
  readonly skin?: Partial<Readonly<Record<SkinTarget, SkinRule>>>;
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
  /**
   * The wipe's panel; `label` is printed across it in the preset's lettering, in `ink`. `ease` is its
   * timing within each leg (in, hold, out): linear (a cut) unless a preset eases it.
   */
  readonly wipe?: { readonly fill: string; readonly mask: string; readonly label?: string; readonly ink?: string; readonly ease?: string };
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
  /** Lines an effect chants (hissResonance's margins, on the HTML-in-Canvas layer), and its CSS label (the first). */
  readonly chant?: ReadonlyArray<string>;
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
  /** The form a send takes (domain/send.ts); unset, the style's own (glide when clean, slap when wobbly). */
  readonly send?: SendForm;
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
      // Half-pixel ramps instead of hard stops: a hard-edged diagonal line rasterizes as a staircase.
      { image: `repeating-linear-gradient(-45deg, transparent 0, ${tint(c("line"), 12)} 0.5px 1px, transparent 1.5px 7px)` },
      { image: `linear-gradient(${tint(c("line"), 35)}, ${tint(c("line"), 35)})`, size: "calc(100% - 24px) 1px", position: "center bottom 96px", repeat: "no-repeat" },
    ],
    mask: "linear-gradient(to top, #000, transparent 96px)",
  },
  image: { surface: "backdrop", strength: 0.12, size: "cover", position: "center" },
} as const satisfies PresetArt;

/** The black of a redaction bar. */
const REDACT = "var(--lively-art-redact, #0b0b0c)";

// Control (Remedy): the Oldest House. Board-formed concrete (fine grain and a grid of form-tie
// holes), a coffered ceiling grid, a lobby's round light, and in the lower right the Astral Plane:
// two monoliths under the Board, an inverted prism with spectral fringes. bb's sidebar content is
// opaque, so the sidebar only carries the prism's light down its inner edge (seen at its head and
// foot). Colors come from themes/lively-control.css, else the accent; the slabs are pale by day
// (text reads over them) and near-black at night.
/**
 * Control's art stays in the thread's free right margin. bb centers the reading column (the
 * timeline and the composer) at most 728px wide with 16px padding, so the margin right of it is
 * `50% - min(364px, 50% - 16px)` of the view; the art shows up to 48px short of the column, fading
 * over 24px, and none at all when the margin is narrower than that. The dock band's copy shares the
 * view's width (it starts at the view's left edge and reaches its right, reach.ts), so this
 * horizontal mask matches across the two. Intersected with it, a bottom-anchored mask clears the
 * dock: nothing within 290px of the bottom, where bb docks the composer and its requests.
 */
const CONTROL_GUTTER_MASK =
  "linear-gradient(to left, #000 calc(50% - min(364px, 50% - 16px) - 48px), transparent calc(50% - min(364px, 50% - 16px) - 24px)) intersect, " +
  "linear-gradient(to top, transparent 0 250px, #000 290px) right bottom / 6000px 4000px no-repeat";

/** Bureau labels: tracked capitals in the preset's lettering (the `--lively-letter-*` properties). */
const LABEL = "font: 600 9px/1 var(--lively-letter-font, sans-serif); letter-spacing: 0.24em; text-transform: uppercase";

/**
 * Control's dress for bb's own controls (ART-DIRECTION.md#control): the Bureau's signage and forms
 * over the Oldest House. Square everything; the composer is a form under corner brackets with a
 * Hiss-red tab; the send button carries a red bar; what you send is filed as a directive, numbered
 * by its place in the thread; the thread's title is a sign; menus and dialogs are case files with a
 * red tab; and the empty page a thread starts on is the Astral Plane: the Board over the white void
 * (concrete at night), stark light falling past two monoliths, the Bureau's name lettered on the
 * floor. Paint at rest, so it holds with every effect off.
 */
const CONTROL_SKIN = {
  focusBox: {
    style: `border-radius: 0; border-color: ${tint(c("sign"), 38)}`,
    layers: [bar(c("alarm"), "36px", "3px", "left 16px top 0"), ...corners(c("sign"), 10, 2)],
  },
  sendButton: {
    style: `border-radius: 0; box-shadow: inset 0 -3px 0 ${c("alarm")}`,
  },
  // A directive's file line over each of your messages: its number in the thread, after a red tick.
  sentRow: {
    before: `content: "Directive \\2002 №\\00a0" attr(data-index); display: block; text-align: right; padding: 0 9px 6px 0; ${LABEL}; color: var(--muted-foreground, currentColor); background: linear-gradient(${c("alarm")}, ${c("alarm")}) right 2px top 0 / 2px 9px no-repeat`,
  },
  threadTitle: {
    style: `${LABEL}; font-size: 12px; letter-spacing: 0.16em; font-weight: 700; color: ${c("sign")}`,
  },
  pageHeader: {
    style: `border-bottom-color: ${tint(c("sign"), 45)}`,
    layers: [bar(c("alarm"), "28px", "3px", "left 16px bottom 0")],
  },
  sidePanel: {
    layers: [bar(c("alarm"), "3px", "48px", "left 0 top 0"), bar(tint(c("sign"), 35), "1px", "100%", "left 0 top 0")],
  },
  overlayOpen: {
    style: "border-radius: 0",
    layers: [bar(c("alarm"), "24px", "3px", "left 0 top 0"), bar(tint(c("sign"), 50), "100%", "1px", "left 0 top 0")],
  },
  dialogOpen: {
    style: `border-radius: 0; box-shadow: 0 0 0 1px ${tint(c("sign"), 40)}, 0 28px 64px -24px #000c`,
    layers: [bar(c("alarm"), "48px", "4px", "left 0 top 0"), ...corners(c("sign"), 14, 2)],
  },
  // The Astral Plane behind a new thread: the Board, stark light, two monoliths, and the Bureau's name.
  composeHome: {
    style: "position: relative; isolation: isolate",
    layers: [
      // The Board, its edges split into the spectrum, centered under the composer.
      { image: `conic-gradient(from -30deg at 50% 100%, ${c("board")} 0 60deg, transparent 60deg)`, size: "176px 152px", position: "center top 300px", repeat: "no-repeat" },
      {
        image: "conic-gradient(from -33deg at 50% 100%, #ff2a3a 0deg, #ffb000 1.2deg, #34c759 2.4deg, #2f9bff 3.6deg, transparent 3.8deg 62.2deg, #2f9bff 62.4deg, #34c759 63.6deg, #ffb000 64.8deg, #ff2a3a 66deg, transparent 66.2deg)",
        size: "196px 162px",
        position: "center top 296px",
        repeat: "no-repeat",
      },
      // Two monoliths floating either side, lit along their tops.
      bar(c("rim"), "46px", "2px", "left 22% top 360px"),
      bar(c("board"), "46px", "260px", "left 22% top 362px"),
      bar(c("rim"), "28px", "2px", "right 20% top 420px"),
      bar(c("board"), "28px", "150px", "right 20% top 422px"),
      bar(c("alarm"), "28px", "2px", "right 20% top 572px"),
      // Stark shafts of light from above.
      { image: `linear-gradient(to bottom, ${tint(c("light"), 70)}, ${tint(c("light"), 20)} 50%, transparent 90%)`, size: "64px 100%", position: "left 21% top 0", repeat: "no-repeat" },
      { image: `linear-gradient(to bottom, ${tint(c("light"), 50)}, transparent 80%)`, size: "120px 100%", position: "left 58% top 0", repeat: "no-repeat" },
      { image: `linear-gradient(to bottom, ${tint(c("light"), 60)}, transparent 70%)`, size: "22px 100%", position: "right 19% top 0", repeat: "no-repeat" },
    ],
    // The Bureau's name, lettered large on the floor of the void.
    before: `content: "Federal Bureau of Control"; position: absolute; left: 32px; bottom: 44px; z-index: -1; pointer-events: none; font: 800 clamp(28px, 4.4vw, 64px)/1 var(--lively-letter-font, sans-serif); letter-spacing: 0.06em; text-transform: uppercase; color: ${tint(c("sign"), 9)}`,
    after: `content: "The Oldest House \\2002·\\2002 Designation 01-A \\2002·\\2002 Clearance on request"; position: absolute; left: 34px; bottom: 24px; z-index: -1; pointer-events: none; ${LABEL}; color: ${tint(c("sign"), 30)}`,
  },
} as const satisfies PresetArt["skin"];

const CONTROL_ART = {
  colors: {
    monolith: token("--lively-art-monolith", "color-mix(in oklab, #000 70%, var(--lively-canvas))"),
    rim: tint(token("--lively-art-rim", "var(--lively-accent)"), 55),
    line: token("--lively-art-line", "var(--lively-accent)"),
    light: tint(token("--lively-art-light", "var(--lively-accent)"), 22),
    hiss: tint(token("--lively-art-hiss", "var(--destructive, #e01b24)"), 70),
    // The Bureau's signage: off-white at night, ink by day; and the Hiss's red at full strength, for its tabs.
    sign: token("--lively-art-sign", "var(--lively-accent)"),
    alarm: token("--lively-art-hiss", "var(--destructive, #e01b24)"),
    // The Board and the Astral Plane's slabs on the empty page: black on the white void, blacker than concrete at night.
    board: token("--lively-art-board", "color-mix(in oklab, #000 80%, var(--lively-canvas))"),
  },
  skin: CONTROL_SKIN,
  // All of it lives in the thread's free right margin, never behind the reading column or the dock
  // (CONTROL_GUTTER_MASK): a cluster that fits a 140px gutter, floating clear of the dock, as the
  // Astral Plane's slabs float. A narrow thread has no margin, and no art.
  backdrop: {
    layers: [
      // The Board: an inverted triangle (a 60-degree wedge from its apex, which points down) above
      // the monoliths, its edges split into the spectrum.
      { image: `conic-gradient(from -30deg at 50% 100%, ${c("monolith")} 0 60deg, transparent 60deg)`, size: "104px 90px", position: "right 30px bottom 540px", repeat: "no-repeat" },
      {
        image: "conic-gradient(from -33deg at 50% 100%, #ff2a3a 0deg, #ffb000 1.2deg, #34c759 2.4deg, #2f9bff 3.6deg, transparent 3.8deg 62.2deg, #2f9bff 62.4deg, #34c759 63.6deg, #ffb000 64.8deg, #ff2a3a 66deg, transparent 66.2deg)",
        size: "116px 96px",
        position: "right 24px bottom 537px",
        repeat: "no-repeat",
      },
      // Two floating monoliths: a lit top edge, then the slab; a thin Hiss-red seam under the taller one.
      rect(c("rim"), 80, 488, 40, 2),
      rect(c("hiss"), 80, 290, 40, 2),
      rect(c("monolith"), 80, 292, 40, 196),
      rect(c("rim"), 36, 438, 22, 2),
      rect(c("monolith"), 36, 320, 22, 118),
      // A lobby's round light above the Board: a ring and its soft pool.
      { image: `radial-gradient(circle at right 82px bottom 712px, transparent 0 40px, ${c("light")} 40px 41px, transparent 42px)`, size: "400px 900px", position: "right bottom", repeat: "no-repeat" },
      { image: `radial-gradient(130px 130px at right 82px bottom 712px, ${tint(c("light"), 40)}, transparent 70%)`, size: "400px 900px", position: "right bottom", repeat: "no-repeat" },
      // Stark light shafts falling from the coffers, past the monoliths: the Oldest House's lobby light.
      { image: `linear-gradient(to bottom, ${tint(c("light"), 60)}, ${tint(c("light"), 18)} 45%, transparent 80%)`, size: "18px 610px", position: "right 104px bottom 290px", repeat: "no-repeat" },
      { image: `linear-gradient(to bottom, ${tint(c("light"), 40)}, transparent 70%)`, size: "8px 610px", position: "right 20px bottom 290px", repeat: "no-repeat" },
      // The coffered ceiling: a 96px grid, each coffer with a recessed inner edge 8px in.
      { image: `linear-gradient(to left, ${tint(c("line"), 9)} 1px, transparent 1px)`, size: "96px 96px", position: "right bottom" },
      { image: `linear-gradient(to top, ${tint(c("line"), 9)} 1px, transparent 1px)`, size: "96px 96px", position: "right bottom" },
      { image: `linear-gradient(to left, ${tint(c("line"), 5)} 1px, transparent 1px)`, size: "96px 96px", position: "right 8px bottom 0px" },
      { image: `linear-gradient(to top, ${tint(c("line"), 5)} 1px, transparent 1px)`, size: "96px 96px", position: "right 0px bottom 8px" },
      // Form-tie holes and the boards' grain.
      { image: `radial-gradient(circle, ${tint(c("line"), 16)} 1.4px, transparent 2px)`, size: "48px 48px", position: "right 24px bottom 24px" },
      { image: `linear-gradient(to top, ${tint(c("line"), 3)} 1px, transparent 1px)`, size: "7px 7px", position: "right bottom" },
    ],
    mask: CONTROL_GUTTER_MASK,
  },
  sidebar: {
    layers: [
      // The prism's light: a spectral hairline down the sidebar's inner edge.
      {
        image: "linear-gradient(to bottom, transparent, #ff2a3a99 20%, #ffb00099 38%, #34c75999 56%, #2f9bff99 74%, transparent)",
        size: "1px 100%",
        position: "right 0 top 0",
        repeat: "no-repeat",
      },
      // A thin rule across the foot, as on a Bureau form.
      { image: `linear-gradient(${tint(c("line"), 30)}, ${tint(c("line"), 30)})`, size: "calc(100% - 24px) 1px", position: "center bottom 48px", repeat: "no-repeat" },
    ],
  },
  image: { surface: "backdrop", strength: 0.14, size: "cover", position: "center" },
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
    // A send is a hit: the words jump and cut, the message slaps in with a flash and a sticker shadow.
    send: "slap",
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
    // A send is a function executing: the words whitewash into the Process's cells, the message assembles along a trace.
    send: "process",
    // A clean 1920s sans for reading, as kb's Transistor (Jost, OFL), then system geometric faces.
    // No font file ships: the Macs install Jost and Josefin Sans (modules/stacks/bb/darwin.nix).
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
    // A send is a transmission: a scan bar erases the words; the message prints in under one.
    send: "scan",
    fonts: { sans: '"Helvetica Neue", Helvetica, "Nimbus Sans", Arial, ui-sans-serif, system-ui, sans-serif' },
    tokens: { overshoot: 0, blur: 0, tilt: 0, liftShadow: 0 },
    paint: {
      // A scan: fine, soft-edged scanlines over a plate of the canvas a shade toward the ink, eased into
      // place and out again. (It was 6px solid ink bars on a linear sweep: a dark strobe at every switch.)
      wipe: {
        fill: "repeating-linear-gradient(0deg, transparent 0, color-mix(in oklab, var(--lively-art-line, var(--lively-accent)) 34%, transparent) 1.5px 2.5px, transparent 4px), color-mix(in oklab, var(--canvas, Canvas) 88%, var(--lively-art-line, var(--lively-accent)))",
        mask: "linear-gradient(90deg, transparent 4%, #000 24% 76%, transparent 96%)",
        ease: "var(--lively-ease-steady)",
      },
      chroma: ["var(--lively-art-rim, var(--lively-accent-2))", "#4a7a8c"],
    },
  },
  {
    id: "control",
    label: "Control",
    description:
      "After Remedy's Control: the Oldest House's concrete, the Bureau's grotesque and wayfinding capitals, precise motion with no overshoot, documents redacted in black bars as you switch threads, the architecture shifting with prismatic fringes, the Board's prism at the composer and in the sidebar, what you send coming apart into the Hiss's dark, prismatic dust drifting up and your message condensing out of it, and the Hiss's red resonance while an agent waits for you. Uses HTML-in-Canvas when bb is started with it (bb Launcher), CSS otherwise. The Lively Control palette: concrete at night, the Astral Plane by day.",
    artDirection: "ART-DIRECTION.md#control",
    values: {
      intensity: "lively",
      style: "clean",
      stickers: "off",
      effects: { pageWipe: true, shiftWarp: true, hissResonance: true, prismEdge: true },
    },
    palette: "lively-control",
    art: CONTROL_ART,
    // A send is taken by the Hiss: the words come apart into dark, prismatic dust drifting up, and the message condenses out of it.
    send: "dust",
    // Documents in a Swiss grotesque (the Bureau's case files), then system ones. No font file ships.
    fonts: { sans: '"Basic Commercial", "Akzidenz-Grotesk", "Helvetica Neue", Helvetica, Inter, Arial, ui-sans-serif, system-ui, sans-serif' },
    // Bureau precision: nothing passes its mark, nothing tilts; a little blur as things come into focus.
    tokens: { overshoot: 0, tilt: 0, glow: 0.18 },
    // Wayfinding: tracked capitals in a highway-sign grotesque, in the sign's off-white (or black by day).
    lettering: {
      font: 'Overpass, "Barlow Semi Condensed", Barlow, Interstate, "DIN Alternate", "Helvetica Neue", Arial, sans-serif',
      color: "var(--lively-art-sign, var(--lively-accent))",
      sidebar: "Executive   Research   Maintenance   Containment   Astral Plane",
      // The Board speaks in alternatives; these are ours, not the game's.
      chant: ["Awaiting/clearance", "Approve/withhold", "The request is/was/will be open", "Sign/do not sign", "Hold/release"],
    },
    paint: {
      // A Bureau document sweeps across: off-white paper, every line redacted in a black bar of its own length.
      wipe: {
        fill: [
          // Three lines to a 66px tile: bars 13px tall at a 22px pitch, each line its own length.
          `linear-gradient(to bottom, ${REDACT} 0 13px, transparent 13px) 34% 40px / 30% 66px repeat-y`,
          `linear-gradient(to bottom, ${REDACT} 0 13px, transparent 13px) 36% 62px / 20% 66px repeat-y`,
          `linear-gradient(to bottom, ${REDACT} 0 13px, transparent 13px) 38% 84px / 26% 66px repeat-y`,
          "var(--lively-art-paper, #e8e6e1)",
        ].join(", "),
        mask: "linear-gradient(90deg, transparent 16%, #000 16% 84%, transparent 84%)",
        label: "Redacted",
        ink: "var(--lively-art-hiss, #e01b24)",
      },
      // Dispersion: Hiss red and the cold side of the spectrum.
      chroma: ["var(--lively-art-hiss, #ff2a3a)", "#2fb8ff"],
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
