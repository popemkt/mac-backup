/**
 * The palette as the inspectors offer it: each `CANVAS_PALETTE` entry with
 * its swatch, drawn in its design token (`paletteToken`).
 */
import { CANVAS_PALETTE, paletteToken } from "@kb/canvas";

/** The palette as the inspectors offer it: each entry, its name, and its swatch. */
export const CANVAS_SWATCHES = CANVAS_PALETTE.map((entry) => ({
  id: entry.id,
  label: entry.name,
  css: `var(${paletteToken(entry.id)})`,
}));
