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

/**
 * Only reached when a token does not resolve (no stylesheet, as in a unit
 * test): mid grey, so a missing token reads as missing rather than as a
 * deliberate colour.
 */
const MISSING_TOKEN = "rgb(128, 128, 128)";

export function readLabPalette(): LabPalette {
  const read = (token: string) => readTokenColor(token, { fallback: MISSING_TOKEN });
  return {
    ground: read("--lab-ground"),
    edge: read("--lab-edge"),
    hue: read("--lab-hue"),
    ink: read("--lab-ink"),
    accent: read("--lab-accent"),
  };
}
