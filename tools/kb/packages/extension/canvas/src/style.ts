/**
 * How an item or an edge looks, read in one place (`styleOf`): every
 * renderer — the DOM canvas, the 3D faces and meshes, the inspectors, the
 * agent's description — asks this reader rather than the record's fields,
 * so what a look means, and its default for each kind of item, is decided
 * once. The record keeps the format's own fields: JSON Canvas's `color`,
 * and kb's `style` extension (`./style-fields.ts`).
 *
 * A colour is either one of the palette's (`CANVAS_PALETTE`), which a
 * renderer resolves through its design tokens so it follows light and dark,
 * or a literal CSS colour (JSON Canvas's hex), painted as written.
 */
import { dropExtra } from "./extra.ts";
import { CanvasRelationError } from "./relations.ts";
import {
  isGroupNode,
  isKbNode,
  isPathNode,
  isShapeNode,
  isTextNode,
  type CanvasEdge,
  type CanvasNode,
} from "./doc.ts";
import {
  CANVAS_LOOKS,
  isEmptyStyle,
  type CanvasLooks,
  type CanvasStyleField,
} from "./style-fields.ts";

/**
 * The palette, by the id the format writes in `color`: JSON Canvas's six
 * presets ("1"–"6"), then the colours kb adds, written by their names. Each
 * is called by its name, which `color` may also hold.
 */
export const CANVAS_PALETTE = [
  { id: "1", name: "red" },
  { id: "2", name: "orange" },
  { id: "3", name: "yellow" },
  { id: "4", name: "green" },
  { id: "5", name: "cyan" },
  { id: "6", name: "purple" },
  { id: "blue", name: "blue" },
  { id: "pink", name: "pink" },
  { id: "grey", name: "grey" },
] as const;

type CanvasPaletteEntry = (typeof CANVAS_PALETTE)[number];
export type CanvasPaletteId = CanvasPaletteEntry["id"];

/** A colour as it is painted: a palette entry, or a literal CSS colour. */
export type CanvasPaint =
  | { readonly kind: "palette"; readonly id: CanvasPaletteId }
  | { readonly kind: "literal"; readonly css: string };

/** What an item or an edge looks like, every look given (its kind's default when unwritten). */
export interface CanvasStyle extends Required<CanvasLooks> {
  /** Its colour; absent, the renderer's own ink. */
  readonly color?: CanvasPaint;
}

/** The palette entry `color` names, by its id or its name. */
function paletteEntry(color: string): CanvasPaletteEntry | undefined {
  const named = color.trim().toLowerCase();
  return CANVAS_PALETTE.find((entry) => entry.id === color || entry.name === named);
}

/** A written colour as it is painted; undefined for none (absent or blank). */
function paintOf(color: string | undefined): CanvasPaint | undefined {
  if (color === undefined || color.trim() === "") return undefined;
  const entry = paletteEntry(color);
  return entry === undefined ? { kind: "literal", css: color } : { kind: "palette", id: entry.id };
}

/** A hex colour as JSON Canvas writes one: `#rgb` or `#rrggbb`. */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Whether `color` names a colour kb writes: a palette entry by its name or
 * its id (JSON Canvas's presets 1–6 among them), or a hex. What a verb's
 * input and every write check a colour by (`canvasColor`).
 */
export function isCanvasColor(color: string): boolean {
  return paletteEntry(color) !== undefined || HEX_COLOR.test(color.trim());
}

/**
 * A colour as kb writes it: a palette entry by its id (so "red" is written
 * "1", the JSON Canvas preset other readers know), a hex as given. Throws
 * `CanvasRelationError` for anything else (`isCanvasColor`).
 */
export function canvasColor(color: string): string {
  if (!isCanvasColor(color)) {
    throw new CanvasRelationError(
      `"${color}" is no colour kb writes: a palette name, a preset 1–6, or a hex`,
    );
  }
  return paletteEntry(color)?.id ?? color.trim();
}

/** What a paint is called in words: a palette entry's name, or the literal colour. */
export function paintName(paint: CanvasPaint): string {
  if (paint.kind === "literal") return paint.css;
  return CANVAS_PALETTE.find((entry) => entry.id === paint.id)?.name ?? paint.id;
}

/** Every look's default, before an item's kind says otherwise. */
const DEFAULT_LOOKS: Required<CanvasLooks> = {
  fill: "semi",
  dash: "solid",
  size: "m",
  font: "sans",
  align: "start",
  valign: "top",
  opacity: 1,
};

/**
 * The looks that differ by kind: a frame is a dashed outline round what it
 * holds, its name small in its corner; a shape's label sits in its middle;
 * a line is a line, unfilled even when it closes.
 */
function kindLooks(record: CanvasNode | CanvasEdge): Partial<CanvasLooks> {
  if ("fromNode" in record) return {};
  if (isGroupNode(record)) return { fill: "none", dash: "dashed", size: "s" };
  if (isPathNode(record)) return { fill: "none" };
  if (isShapeNode(record)) return { align: "middle", valign: "middle" };
  return {};
}

/** The looks `record` is drawn with when it writes none of its own. */
function defaultsOf(record: CanvasNode | CanvasEdge): Required<CanvasLooks> {
  return { ...DEFAULT_LOOKS, ...kindLooks(record) };
}

/** The `style` `record` writes; its looks are only those kb could read. */
function styleField(record: CanvasNode | CanvasEdge): CanvasStyleField {
  return ("style" in record ? record.style : undefined) ?? {};
}

/** `defaults` with every look `written` names in place of its default. */
function overLooks(defaults: Required<CanvasLooks>, written: CanvasLooks): Required<CanvasLooks> {
  return {
    fill: written.fill ?? defaults.fill,
    dash: written.dash ?? defaults.dash,
    size: written.size ?? defaults.size,
    font: written.font ?? defaults.font,
    align: written.align ?? defaults.align,
    valign: written.valign ?? defaults.valign,
    opacity: written.opacity ?? defaults.opacity,
  };
}

/** The look of `record`, an item or an edge: what every renderer paints it with. */
export function styleOf(record: CanvasNode | CanvasEdge): CanvasStyle {
  const looks = overLooks(defaultsOf(record), styleField(record));
  const color = paintOf(record.color);
  return color === undefined ? looks : { ...looks, color };
}

/**
 * Whether an item's words are its own, so it sets them in its style's size,
 * face and alignment: a text card's, a shape's label, a frame's name. A
 * card's words are its node's, set as the outline sets them, and a picture
 * has none.
 */
export function ownsWords(item: CanvasNode): boolean {
  return isTextNode(item) || isShapeNode(item) || isGroupNode(item);
}

/**
 * Whether an item draws a ground and an outline of its own, filled and
 * stroked as its style says: everything that owns its words, a card, and a
 * line (its outline the line itself). A picture's ground is its picture.
 */
export function drawsGround(item: CanvasNode): boolean {
  return ownsWords(item) || isKbNode(item) || isPathNode(item);
}

/** The looks `record` draws that are not its kind's defaults: what it says of itself. */
export function writtenLooks(record: CanvasNode | CanvasEdge): CanvasLooks {
  const style = styleOf(record);
  const defaults = defaultsOf(record);
  const out: Record<string, unknown> = {};
  for (const key of CANVAS_LOOKS) {
    if (style[key] !== defaults[key]) out[key] = style[key];
  }
  return out;
}

/** A change of looks: each one named set to a value, or to undefined to go back to its default. */
export type CanvasLooksPatch = { readonly [K in keyof CanvasLooks]?: CanvasLooks[K] | undefined };

/**
 * `item` — an item or an edge — with `patch` applied to its looks. A look
 * set to its kind's default, or to undefined, is written as no look at all,
 * so one put back leaves the document as it was; one set here supersedes a
 * value this version could not read, and a record with no look left
 * carries no `style`.
 */
export function withStyle<N extends CanvasNode | CanvasEdge>(item: N, patch: CanvasLooksPatch): N {
  const defaults = defaultsOf(item);
  const before = styleField(item);
  /** A look as it is written after the patch: absent when it is the default. */
  const look = <K extends keyof CanvasLooks>(key: K): CanvasLooks[K] => {
    const value = key in patch ? patch[key] : before[key];
    return value === defaults[key] ? undefined : value;
  };
  const unread = Object.entries(before.extra ?? {}).filter(([key]) => !(key in patch));
  const [fill, dash, size, font] = [look("fill"), look("dash"), look("size"), look("font")];
  const [align, valign, opacity] = [look("align"), look("valign"), look("opacity")];
  const style: CanvasStyleField = {
    ...(fill === undefined ? {} : { fill }),
    ...(dash === undefined ? {} : { dash }),
    ...(size === undefined ? {} : { size }),
    ...(font === undefined ? {} : { font }),
    ...(align === undefined ? {} : { align }),
    ...(valign === undefined ? {} : { valign }),
    ...(opacity === undefined ? {} : { opacity }),
    ...(unread.length > 0 ? { extra: Object.fromEntries(unread) } : {}),
  };
  const out = dropExtra({ ...item }, "style");
  if (isEmptyStyle(style)) delete out.style;
  else out.style = style;
  return out;
}
