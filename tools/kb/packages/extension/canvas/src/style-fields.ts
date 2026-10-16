/**
 * The `style` extension field as the format holds it (DESIGN.md → Canvas
 * documents): an object of named looks, read and written as every other
 * record's fields are (`./fields.ts`), so what kb cannot read in it stays in
 * it untouched — the format's round-trip rule, one level down. What a look
 * means, and its default for each kind of item, is `style.ts`'s.
 */
import type { WithExtra } from "./extra.ts";
import {
  fieldKeys,
  finite,
  isRecord,
  oneOf,
  readFields,
  writeFields,
  type FieldCodecs,
} from "./fields.ts";

/** How an item's ground is filled: not at all, a wash of its colour over the ground, or its colour. */
export const CANVAS_FILLS = ["none", "semi", "solid"] as const;
/** How an outline is stroked: unbroken, in dashes, in dots, or not at all. */
export const CANVAS_DASHES = ["solid", "dashed", "dotted", "none"] as const;
/** How large its words are set and how heavy its outline is drawn. */
export const CANVAS_SIZES = ["s", "m", "l", "xl"] as const;
/** Which of the design system's faces its words are set in. */
export const CANVAS_FONTS = ["sans", "serif", "mono"] as const;
/** Where its words sit across its box, and up and down it. */
export const CANVAS_ALIGNS = ["start", "middle", "end"] as const;
export const CANVAS_VALIGNS = ["top", "middle", "bottom"] as const;

export type CanvasFill = (typeof CANVAS_FILLS)[number];
export type CanvasDash = (typeof CANVAS_DASHES)[number];
export type CanvasSize = (typeof CANVAS_SIZES)[number];
export type CanvasFont = (typeof CANVAS_FONTS)[number];
export type CanvasAlign = (typeof CANVAS_ALIGNS)[number];
export type CanvasVAlign = (typeof CANVAS_VALIGNS)[number];

/** The looks a `style` names, each one only when written. */
export interface CanvasLooks {
  readonly fill?: CanvasFill;
  readonly dash?: CanvasDash;
  readonly size?: CanvasSize;
  readonly font?: CanvasFont;
  readonly align?: CanvasAlign;
  readonly valign?: CanvasVAlign;
  /** How opaque the whole item is drawn, 0 (not at all) to 1. */
  readonly opacity?: number;
}

/** A `style` as read: its looks, and what in it kb could not read, kept for round-trip. */
export type CanvasStyleField = CanvasLooks & WithExtra;

type CanvasLook = keyof CanvasLooks;

/** Each look, in the order a style is written. */
const LOOK_FIELDS: FieldCodecs<CanvasLooks, CanvasLook> = {
  fill: { read: (raw) => oneOf(CANVAS_FILLS, raw) },
  dash: { read: (raw) => oneOf(CANVAS_DASHES, raw) },
  size: { read: (raw) => oneOf(CANVAS_SIZES, raw) },
  font: { read: (raw) => oneOf(CANVAS_FONTS, raw) },
  align: { read: (raw) => oneOf(CANVAS_ALIGNS, raw) },
  valign: { read: (raw) => oneOf(CANVAS_VALIGNS, raw) },
  opacity: {
    read: (raw) => {
      const value = finite(raw);
      return value !== undefined && value >= 0 && value <= 1 ? value : undefined;
    },
  },
};

/** Every look's key, in the order a style is written. */
export const CANVAS_LOOKS = fieldKeys(LOOK_FIELDS);

/**
 * A `style` as written, read: undefined when it is not an object at all,
 * which leaves it an unknown field of the item.
 */
export function parseStyleField(raw: unknown): CanvasStyleField | undefined {
  if (!isRecord(raw)) return undefined;
  const looks: { -readonly [K in CanvasLook]?: CanvasLooks[K] } = {};
  const extra = readFields(LOOK_FIELDS, raw, looks);
  return { ...looks, ...(extra ? { extra } : {}) };
}

/** A style as the format writes it: its looks, then what kb could not read. */
export function emitStyleField(style: CanvasStyleField): Record<string, unknown> {
  const out = writeFields(LOOK_FIELDS, style, {});
  if (style.extra) Object.assign(out, style.extra);
  return out;
}

/** Whether a style holds nothing at all: no look, nothing unread. */
export function isEmptyStyle(style: CanvasStyleField): boolean {
  return style.extra === undefined && CANVAS_LOOKS.every((key) => style[key] === undefined);
}
