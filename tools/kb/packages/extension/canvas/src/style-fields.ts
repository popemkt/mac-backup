/**
 * The `style` extension field as the format holds it (DESIGN.md → Canvas
 * documents): an object of named looks, each key read when it holds a value
 * kb knows. A key kb does not know, or a known key holding a value it cannot
 * read, stays in the object untouched until kb writes that key itself — the
 * format's round-trip rule, one level down. What a look means, and its
 * default for each kind of item, is `style.ts`'s.
 */
import type { WithExtra } from "./extra.ts";

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

/** Each look's reader: the value when kb can read it, else undefined. */
const LOOK_READERS: { readonly [K in CanvasLook]-?: (raw: unknown) => CanvasLooks[K] } = {
  fill: (raw) => CANVAS_FILLS.find((v) => v === raw),
  dash: (raw) => CANVAS_DASHES.find((v) => v === raw),
  size: (raw) => CANVAS_SIZES.find((v) => v === raw),
  font: (raw) => CANVAS_FONTS.find((v) => v === raw),
  align: (raw) => CANVAS_ALIGNS.find((v) => v === raw),
  valign: (raw) => CANVAS_VALIGNS.find((v) => v === raw),
  opacity: (raw) =>
    typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : undefined,
};

/** Every look's key, in the order a style is written. */
export const CANVAS_LOOKS = Object.keys(LOOK_READERS).filter(
  (key): key is CanvasLook => key in LOOK_READERS,
);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A `style` as written, read: undefined when it is not an object at all,
 * which leaves it an unknown field of the item.
 */
export function parseStyleField(raw: unknown): CanvasStyleField | undefined {
  if (!isRecord(raw)) return undefined;
  const looks: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const look = CANVAS_LOOKS.find((k) => k === key);
    const read = look === undefined ? undefined : LOOK_READERS[look](value);
    if (read === undefined) extra[key] = value;
    else looks[key] = read;
  }
  return { ...looks, ...(Object.keys(extra).length > 0 ? { extra } : {}) };
}

/** A style as the format writes it: its looks, then what kb could not read. */
export function emitStyleField(style: CanvasStyleField): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of CANVAS_LOOKS) {
    const value = style[key];
    if (value !== undefined) out[key] = value;
  }
  if (style.extra) Object.assign(out, style.extra);
  return out;
}

/** Whether a style holds nothing at all: no look, nothing unread. */
export function isEmptyStyle(style: CanvasStyleField): boolean {
  return style.extra === undefined && CANVAS_LOOKS.every((key) => style[key] === undefined);
}
