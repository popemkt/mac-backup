/**
 * How an item or an edge looks, read in one place (`styleOf`): every
 * renderer — the DOM canvas, the 3D faces and meshes, the inspectors —
 * asks this reader rather than the record's fields, so what a look means is
 * decided once. The record keeps the format's own fields (JSON Canvas's
 * `color`); the reader turns them into what is painted.
 *
 * A colour is either one of the palette's (`CANVAS_PALETTE`), which a
 * renderer resolves through its design tokens so it follows light and dark,
 * or a literal CSS colour (JSON Canvas's hex), painted as written.
 */

/**
 * The palette: JSON Canvas's six colour presets, by the id the format
 * writes, each with the name it is called by.
 */
export const CANVAS_PALETTE = [
  { id: "1", name: "red" },
  { id: "2", name: "orange" },
  { id: "3", name: "yellow" },
  { id: "4", name: "green" },
  { id: "5", name: "cyan" },
  { id: "6", name: "purple" },
] as const;

type CanvasPaletteEntry = (typeof CANVAS_PALETTE)[number];
export type CanvasPaletteId = CanvasPaletteEntry["id"];

/** A colour as it is painted: a palette entry, or a literal CSS colour. */
export type CanvasPaint =
  | { readonly kind: "palette"; readonly id: CanvasPaletteId }
  | { readonly kind: "literal"; readonly css: string };

/** What an item or an edge looks like. */
interface CanvasStyle {
  /** Its colour; absent, the renderer's own ink. */
  readonly color?: CanvasPaint;
}

/** The palette entry `color` names by its id, or undefined. */
function paletteEntry(color: string): CanvasPaletteEntry | undefined {
  return CANVAS_PALETTE.find((entry) => entry.id === color);
}

/** A written colour as it is painted; undefined for none (absent or blank). */
function paintOf(color: string | undefined): CanvasPaint | undefined {
  if (color === undefined || color.trim() === "") return undefined;
  const entry = paletteEntry(color);
  return entry === undefined ? { kind: "literal", css: color } : { kind: "palette", id: entry.id };
}

/** The look of `record`, an item or an edge: what every renderer paints it with. */
export function styleOf(record: { readonly color?: string }): CanvasStyle {
  const color = paintOf(record.color);
  return color === undefined ? {} : { color };
}
