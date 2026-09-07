/**
 * The device-level appearance vocabulary: the value sets themselves, so both
 * the store that persists them and the leaf modules that read them name one
 * declaration rather than two copies.
 */
export const THEMES = ["light", "dark", "system"] as const;
export type ThemePref = (typeof THEMES)[number];

export const WIDTHS = ["centered", "full"] as const;
export type WidthPref = (typeof WIDTHS)[number];
