export const THEMES = ["light", "dark", "system"] as const;
export type ThemePref = (typeof THEMES)[number];
