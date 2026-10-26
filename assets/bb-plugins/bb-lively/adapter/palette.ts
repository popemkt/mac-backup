// Presets carry a palette (a bb theme lively ships, `bb.themes` in
// package.json). A plugin can switch bb's theme (`bb.sdk.theme.set`, the same
// call as `bb theme set`), so server.ts does, once, when a settings write
// changes the effective palette, never on load: a theme the person picks
// afterwards in Settings → Appearance stays. Picking a preset without a
// palette (or Keep my bb theme) puts back the theme they had before lively
// first switched it, unless they have changed theme since.

/** The bb theme id of one of lively's palettes. */
export const themeIdOf = (pluginId: string, palette: string): string => `plugin:${pluginId}:${palette}`;

/** The storage key holding the theme the person had before lively switched it. */
export const SAVED_THEME_KEY = "palette.before";

export interface PaletteStep {
  /** The theme to switch to, if any. */
  readonly set?: string;
  /** The saved theme's new value: a theme id, null to forget it, or undefined to leave it. */
  readonly saved?: string | null;
}

/**
 * What to do when the effective palette goes from `before` to `after`
 * (palette ids, null for none), with bb's `active` theme id and the theme
 * saved earlier (if any).
 */
export function paletteStep(args: {
  readonly pluginId: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly active: string;
  readonly saved: string | undefined;
}): PaletteStep {
  const { pluginId, before, after, active, saved } = args;
  if (before === after) return {};
  /** Whether bb still shows the palette lively last switched to (the person has not changed theme since). */
  const ours = before !== null && active === themeIdOf(pluginId, before);
  if (after !== null) {
    const target = themeIdOf(pluginId, after);
    // Remember the person's own theme: the first time, or when they picked another since.
    const keep = saved === undefined || !ours ? active : saved;
    return { ...(active === target ? {} : { set: target }), ...(keep === saved ? {} : { saved: keep }) };
  }
  if (saved === undefined) return {};
  return ours && saved !== active ? { set: saved, saved: null } : { saved: null };
}
