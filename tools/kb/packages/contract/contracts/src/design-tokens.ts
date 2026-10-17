/**
 * The colour tokens a renderer reads (DESIGN-UI.md → Design tokens): the
 * contract between a design system's stylesheet, which defines each, and
 * every painter that paints with one, in the browser or on the server. Each
 * comes with the colour it stands for when there is no document to resolve
 * it against (unit tests, SSR, a server painter). The fallback belongs to
 * the token, not to whichever caller reads it; `css-color.test.ts` (`app/ui`)
 * binds each to the stylesheets.
 */
const TOKEN_FALLBACK = {
  "--foreground": "#222",
  "--background": "#fff",
  "--card": "#fff",
  "--muted": "#f5f5f5",
  "--muted-foreground": "#737373",
  "--primary": "#c27c0e",
  "--border": "#e5e5e5",
  "--popover": "#fff",
  "--popover-foreground": "#222",
  // The design system's chart ramp, light to dark (`@kb/chart-ui`).
  "--chart-1": "#fbd452",
  "--chart-2": "#f49f1e",
  "--chart-3": "#dc7702",
  "--chart-4": "#b75301",
  "--chart-5": "#8f4113",
  "--destructive": "#dc2626",
  "--graph-edge": "rgba(34, 34, 34, 0.4)",
  // The canvas palette (`@kb/canvas` CANVAS_PALETTE, `@kb/canvas-ui`'s `canvas-color`): the
  // JSON Canvas presets "1"–"6" and kb's named colours, which the 3D canvas paints into its
  // card textures.
  "--canvas-color-1": "#dc2626",
  "--canvas-color-2": "#ea580c",
  "--canvas-color-3": "#ca8a04",
  "--canvas-color-4": "#16a34a",
  "--canvas-color-5": "#0891b2",
  "--canvas-color-6": "#9333ea",
  "--canvas-color-blue": "#2563eb",
  "--canvas-color-pink": "#db2777",
  "--canvas-color-grey": "#808080",
  // The lab palette: mid grey, so a missing token reads as missing rather
  // than as a deliberate colour.
  "--lab-ground": "rgb(128, 128, 128)",
  "--lab-edge": "rgb(128, 128, 128)",
  "--lab-hue": "rgb(128, 128, 128)",
  "--lab-ink": "rgb(128, 128, 128)",
  "--lab-accent": "rgb(128, 128, 128)",
} as const;

export type ColorToken = keyof typeof TOKEN_FALLBACK;

/** Every token a renderer may read, with its fallback. */
export const COLOR_TOKEN_FALLBACKS: Readonly<Record<ColorToken, string>> = TOKEN_FALLBACK;
