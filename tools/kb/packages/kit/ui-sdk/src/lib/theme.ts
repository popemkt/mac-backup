/**
 * The device-level appearance vocabulary: the value sets themselves, so both
 * the store that persists them and the leaf modules that read them name one
 * declaration rather than two copies.
 */
export const THEMES = ["light", "dark", "system"] as const;
export type ThemePref = (typeof THEMES)[number];

export const WIDTHS = ["centered", "full"] as const;
export type WidthPref = (typeof WIDTHS)[number];

/**
 * What the page is painted in, resolved: everything that changes the values
 * the design-system tokens hold. DOM styling follows a change by itself (every
 * utility is a live `var()`); canvas and WebGL renderers copied token values
 * out, so they re-read them whenever `key` changes. This is the one signal
 * they listen to.
 */
export interface Appearance {
  /** The id of the design system painting the page (`DesignSystemPoint`). */
  readonly designSystem: string;
  readonly dark: boolean;
  /** Changes exactly when any field above does. */
  readonly key: string;
}

export function appearanceOf(designSystem: string, dark: boolean): Appearance {
  return { designSystem, dark, key: `${designSystem}:${dark ? "dark" : "light"}` };
}

/**
 * The device-level preferences, as the shell's prefs store holds and
 * persists them (`localStorage["kb-prefs"]`).
 */
export interface Prefs {
  theme: ThemePref;
  /*
   * Which design system paints the page was a pref here (`designSystem`).
   * It is core's setting now (DESIGN-UI.md → Design tokens → Design
   * systems), so a stale key is ignored on read and dropped on the next
   * write. So was the UI face before it (`font`): a face is a design-system
   * value.
   */
  width: WidthPref;
  /*
   * The page-head backdrop, its strength and its direction were prefs here
   * (`headerBackdrop`, `backdropStrength`, `backdropDirection`). They are
   * core's settings now (DESIGN-UI.md → Page-head backdrops), so a stale key
   * is ignored on read and dropped on the next write.
   */
  /** Tana-style left rail. Absent in storage → viewport default (≥1024 open). */
  sidebarOpen: boolean;
}
