/**
 * The palette in the DOM: each `CANVAS_PALETTE` entry's design token
 * (`--canvas-color-<id>` on :root and .dark), and a paint (`styleOf`) as the
 * CSS colour it is drawn in. A literal colour passes through as written.
 */
import { CANVAS_PALETTE, type CanvasPaint, type CanvasPaletteId } from "@kb/canvas";

/** The token a palette entry is drawn in, in both projections. */
export function paletteToken(id: CanvasPaletteId) {
  return `--canvas-color-${id}` as const;
}

/** The palette as the inspectors offer it: each entry, its name, and its swatch. */
export const CANVAS_SWATCHES = CANVAS_PALETTE.map((entry) => ({
  id: entry.id,
  label: entry.name,
  css: `var(${paletteToken(entry.id)})`,
}));

/** A paint as a CSS colour, or undefined for none. */
export function paintCss(paint: CanvasPaint | undefined): string | undefined {
  if (paint === undefined) return undefined;
  return paint.kind === "palette" ? `var(${paletteToken(paint.id)})` : paint.css;
}
