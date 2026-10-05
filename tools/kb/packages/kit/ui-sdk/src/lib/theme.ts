/**
 * The device-level appearance vocabulary: the value sets themselves, so both
 * the store that persists them and the leaf modules that read them name one
 * declaration rather than two copies.
 */
export const THEMES = ["light", "dark", "system"] as const;
export type ThemePref = (typeof THEMES)[number];

export const WIDTHS = ["centered", "full"] as const;
export type WidthPref = (typeof WIDTHS)[number];

/** Decorative treatment of the shared page header, independent of its design system. */
export const HEADER_BACKDROPS = ["gradient", "unicorn"] as const;
export type HeaderBackdropPref = (typeof HEADER_BACKDROPS)[number];
export const DEFAULT_HEADER_BACKDROP: HeaderBackdropPref = "unicorn";
export const HEADER_BACKDROP_LABELS: Record<HeaderBackdropPref, string> = {
  gradient: "Gradient",
  unicorn: "Unicorn",
};
/** Presentation controls shared by every header effect. */
export const BACKDROP_STRENGTHS = ["subtle", "soft", "vivid"] as const;
export type BackdropStrength = (typeof BACKDROP_STRENGTHS)[number];
export const BACKDROP_DIRECTIONS = ["down", "up"] as const;
export type BackdropDirection = (typeof BACKDROP_DIRECTIONS)[number];

/** Each effect owns its framing and response to the shared strength control. */
export const HEADER_BACKDROP_PRESENTATION: Record<
  HeaderBackdropPref,
  {
    directions: readonly BackdropDirection[];
    space: number;
    height: number;
    maxWidth: number;
    offset: number;
    opacity: Record<BackdropStrength, number>;
  }
> = {
  gradient: {
    space: 0,
    directions: [],
    height: 160,
    maxWidth: 1120,
    offset: -40,
    opacity: { subtle: 0.5, soft: 0.75, vivid: 1 },
  },
  unicorn: {
    space: 160,
    directions: BACKDROP_DIRECTIONS,
    height: 500,
    maxWidth: 960,
    offset: -8,
    opacity: { subtle: 0.35, soft: 0.5, vivid: 0.75 },
  },
};

/**
 * The design systems (DESIGN-UI.md → Design tokens → Design systems), in
 * picker order, the default first. Each id other than the default names one
 * stylesheet, `design-systems/<id>.css`, whose blocks override layer 1 under
 * `[data-theme="<id>"]`; the default is layer 1 itself. `design-systems.test.ts`
 * holds this list and those stylesheets to each other.
 */
export const DESIGN_SYSTEM_IDS = ["kb", "paper", "terminal"] as const;
export type DesignSystemId = (typeof DESIGN_SYSTEM_IDS)[number];
export const DEFAULT_DESIGN_SYSTEM: DesignSystemId = "kb";

/** What the picker calls each one; a Record, so an id without a label does not compile. */
const DESIGN_SYSTEM_LABELS: Record<DesignSystemId, string> = {
  kb: "kb",
  paper: "Paper",
  terminal: "Terminal",
};

export interface DesignSystem {
  readonly id: DesignSystemId;
  readonly label: string;
}

export const DESIGN_SYSTEMS: readonly DesignSystem[] = DESIGN_SYSTEM_IDS.map((id) => ({
  id,
  label: DESIGN_SYSTEM_LABELS[id],
}));

/**
 * What the page is painted in, resolved: everything that changes the values
 * the design-system tokens hold. DOM styling follows a change by itself (every
 * utility is a live `var()`); canvas and WebGL renderers copied token values
 * out, so they re-read them whenever `key` changes. This is the one signal
 * they listen to.
 */
export interface Appearance {
  readonly designSystem: DesignSystemId;
  readonly dark: boolean;
  /** Changes exactly when any field above does. */
  readonly key: string;
}

export function appearanceOf(designSystem: DesignSystemId, dark: boolean): Appearance {
  return { designSystem, dark, key: `${designSystem}:${dark ? "dark" : "light"}` };
}
