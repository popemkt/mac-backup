/**
 * The lab palette (Lab principles L1): one hue family and one accent, read
 * from the `--lab-*` tokens in `design-system.css` through `css-color`, the same
 * normalisation the graph renderers use. The accent is the app's own
 * `--primary`. A theme change is a re-read; no scene names a colour.
 */
import { readTokenColor } from "@/lib/css-color";

export interface LabPalette {
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

export function readLabPalette(): LabPalette {
  // A token that does not resolve (no stylesheet, as in a unit test) reads
  // as mid grey; that fallback is the token's, in css-color's table.
  return {
    ground: readTokenColor("--lab-ground"),
    edge: readTokenColor("--lab-edge"),
    hue: readTokenColor("--lab-hue"),
    ink: readTokenColor("--lab-ink"),
    accent: readTokenColor("--lab-accent"),
  };
}
