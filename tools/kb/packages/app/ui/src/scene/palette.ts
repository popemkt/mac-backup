/**
 * A scene's palette (Lab principles L1): one hue family and one accent, read
 * from layer-1 colour tokens through `css-color`, the same normalisation every
 * canvas renderer uses. Which tokens fill the five roles is the caller's: the
 * lab reads its `--lab-*` set, the 3D graph the app's own surface colours. A
 * theme change is a re-read; no scene names a colour.
 */
import { readTokenColor, type ColorToken } from "@/lib/css-color";

export interface ScenePalette {
  /** The background at the focal point, and at the frame's edge. */
  readonly ground: string;
  readonly edge: string;
  /** The hue family's mid tone. */
  readonly hue: string;
  /** Highest value contrast against the ground: dark on light, light on dark. */
  readonly ink: string;
  /** The one accent (`--primary`). */
  readonly accent: string;
}

/** Which token fills each palette role. */
export type ScenePaletteTokens = { readonly [Role in keyof ScenePalette]: ColorToken };

export function readScenePalette(tokens: ScenePaletteTokens): ScenePalette {
  // A token that does not resolve (no stylesheet, as in a unit test) reads
  // as its fallback in css-color's table.
  return {
    ground: readTokenColor(tokens.ground),
    edge: readTokenColor(tokens.edge),
    hue: readTokenColor(tokens.hue),
    ink: readTokenColor(tokens.ink),
    accent: readTokenColor(tokens.accent),
  };
}
