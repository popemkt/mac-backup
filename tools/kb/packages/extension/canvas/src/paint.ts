/**
 * An item's or an edge's look as both projections paint it (`itemPaint`,
 * `edgePaint`): `styleOf`'s looks turned into what a painter draws with — a
 * line's width and dash pattern in canvas units, the type step and face
 * words are set in (as design tokens), where they sit, a fill, the length of
 * an edge's heads, an opacity, and every colour as a `Tone`: how much of
 * the ink, the ground, the primary or the item's paint it takes. The DOM
 * canvas and the 3D scene read only this, so a look means one thing in both,
 * and the look contract holds them to it.
 */
import { isGroupNode, isPathNode, isShapeNode, type CanvasEdge, type CanvasNode } from "./doc.ts";
import { isOpenLine } from "./paths.ts";
import { drawsGround, ownsWords, styleOf, type CanvasPaint } from "./style.ts";
import type {
  CanvasAlign,
  CanvasDash,
  CanvasFill,
  CanvasFont,
  CanvasSize,
  CanvasVAlign,
} from "./style-fields.ts";

/** Where a tone's colour comes from: the page's ink or ground, the selection's primary, a paint. */
export type ToneSource = "ink" | "ground" | "primary" | CanvasPaint;

/** The design token each of the page's own tone sources is (a paint names its own). */
export const TONE_TOKENS = {
  ink: "--foreground",
  ground: "--background",
  primary: "--primary",
} as const satisfies { readonly [S in Extract<ToneSource, string>]: `--${string}` };

/**
 * A colour as both projections resolve it: `amount` (0–1) of `of` laid
 * over `over` — the page ground when it names none — composited in sRGB,
 * and opaque. The DOM says it as `color-mix(in srgb, …)` of the tokens
 * (`toneCss`); the face texture mixes the tokens' resolved channels
 * (`toneColor`).
 */
export interface Tone {
  readonly of: ToneSource;
  readonly amount: number;
  readonly over?: Tone;
}

const tone = (of: ToneSource, amount = 1, over?: Tone): Tone =>
  over === undefined ? { of, amount } : { of, amount, over };

/**
 * How much of the ink a kind takes where its paint names no colour, 0–1:
 * its outline (and the heads a line wears), the words it sets, and the
 * placeholder standing in for words it has not got.
 */
interface KindInks {
  readonly outline: number;
  readonly words: number;
  readonly hint: number;
}

/** Each kind's inks (`KindInks`); a file, and a kind kb passes through unread, take `OTHER_INKS`. */
const KIND_INKS: Readonly<Partial<Record<CanvasNode["type"], KindInks>>> = {
  "kb-node": { outline: 0.12, words: 1, hint: 0.3 },
  link: { outline: 0.12, words: 1, hint: 0.3 },
  text: { outline: 0.12, words: 1, hint: 0.3 },
  shape: { outline: 0.18, words: 0.85, hint: 0.25 },
  // A frame's hairline stays firm enough to read when seen at a slant.
  group: { outline: 0.24, words: 0.4, hint: 0.4 },
  path: { outline: 0.6, words: 1, hint: 1 },
};

const OTHER_INKS: KindInks = { outline: 0.12, words: 0.4, hint: 0.4 };

/** How much of its colour a semi fill washes over the ground. */
const WASH = 0.14;

/** How much of the ink an edge with no colour is drawn in, and one whose field is gone. */
const EDGE_INK = { rest: 0.35, unbound: 0.15 } as const;

/** How a selected item's outline is drawn: in the primary, over a soft halo, at least so heavy. */
export const SELECTED_OUTLINE = {
  stroke: tone("primary", 0.7),
  halo: tone("primary", 0.15),
  haloWidth: 6,
  minWidth: 2,
} as const;

/** How heavy an outline is drawn at each size, canvas units. */
const STROKE_WIDTHS: { readonly [S in CanvasSize]: number } = { s: 0.75, m: 1, l: 2, xl: 3.5 };

/**
 * How heavy a line that is the whole drawing — an edge's, a path item's —
 * is drawn at each size, canvas units: it reads over the outlines it joins.
 */
const LINE_WIDTHS: { readonly [S in CanvasSize]: number } = { s: 1, m: 1.5, l: 2.5, xl: 4 };

/** How long the heads a line's ends wear are at each size, canvas units. */
const HEAD_LENGTHS: { readonly [S in CanvasSize]: number } = { s: 7, m: 9, l: 12, xl: 16 };

/** How much heavier a selected edge is drawn, canvas units. */
const SELECTED_WIDEN = 1;

/** The type step words are set at, at each size (`--type-*`). */
export const TYPE_STEPS = {
  s: "--type-label",
  m: "--type-ui",
  l: "--type-heading",
  xl: "--type-title",
} as const satisfies { readonly [S in CanvasSize]: `--type-${string}` };

export type CanvasTypeStep = (typeof TYPE_STEPS)[CanvasSize];

/** Each step's size in the default design system, px: what a painter with no document to resolve the token against sets words at. */
export const TYPE_STEP_FALLBACKS: Readonly<Record<CanvasTypeStep, number>> = {
  "--type-label": 11,
  "--type-ui": 13,
  "--type-heading": 18,
  "--type-title": 20,
};

/** The step a card's own words are set at: its node's words, as the outline sets them. */
export const CARD_BODY_STEP = "--type-body";

/** The card body step's size in the default design system, px. */
export const CARD_BODY_FALLBACK = 14.5;

/** The corner radii an outline is rounded by, px: `rounded-xl` a card's, `rounded-md` a shape's. */
export interface CornerRadii {
  readonly radius: number;
  readonly shapeRadius: number;
}

/** The corner radii in the default design system: what a painter with no document rounds by. */
export const CORNER_RADII_FALLBACKS: CornerRadii = { radius: 18, shapeRadius: 8 };

/**
 * The radius an item's outline is rounded by in every projection
 * (`shapeOutline`): a shape's and a frame's, or a card's for any other item.
 */
export function cornerRadius(item: CanvasNode, radii: CornerRadii): number {
  return isShapeNode(item) || isGroupNode(item) ? radii.shapeRadius : radii.radius;
}

/** The design system's face for each font (`--app-font*`). */
export const FONT_FACES = {
  sans: "--app-font",
  serif: "--app-font-serif",
  mono: "--app-font-mono",
} as const satisfies { readonly [F in CanvasFont]: `--app-font${string}` };

/**
 * An outline's dash pattern at `width`, canvas units (dash, gap, …): empty
 * for an unbroken line. Dashes and dots grow with the line, so a heavy
 * dashed outline keeps its rhythm.
 */
function dashPattern(dash: CanvasDash, width: number): readonly number[] {
  const scale = Math.max(1, width);
  switch (dash) {
    case "dashed":
      return [6 * scale, 4 * scale];
    case "dotted":
      return [1.5 * scale, 3 * scale];
    case "solid":
    case "none":
    default:
      return [];
  }
}

/** How a line is stroked: an item's outline, an edge's line. */
interface OutlinePaint {
  readonly dash: CanvasDash;
  readonly width: number;
  readonly pattern: readonly number[];
}

/** How an item's own words are set. */
export interface WordsPaint {
  readonly step: CanvasTypeStep;
  readonly face: (typeof FONT_FACES)[CanvasFont];
  readonly font: CanvasFont;
  readonly align: CanvasAlign;
  readonly valign: CanvasVAlign;
}

/** How an item's own ground and outline are drawn. */
export interface ChromePaint {
  readonly fill: CanvasFill;
  /** What its ground is filled with; null for no ground (`fill: "none"`). */
  readonly ground: Tone | null;
  /** Null for no outline at all. */
  readonly outline: OutlinePaint | null;
  /** The ink its outline is drawn in, drawn or not: the heads a line wears take it too. */
  readonly stroke: Tone;
}

/** Everything a painter needs of an item's look. */
export interface ItemPaint {
  /** Null for an item that draws no ground of its own (`drawsGround`): a picture. */
  readonly chrome: ChromePaint | null;
  /** Null for an item whose words are not its own (`ownsWords`): a card's, a picture. */
  readonly words: WordsPaint | null;
  /** How long the heads its ends wear are (`pathHeads`); null for an item with no ends. */
  readonly heads: { readonly length: number } | null;
  readonly opacity: number;
  /** The ink its words are set in, its own or its node's, and a placeholder standing in for none. */
  readonly ink: { readonly words: Tone; readonly hint: Tone };
}

/** What a ground of `fill` is filled with, in `color` or none. */
function groundTone(fill: CanvasFill, color: CanvasPaint | undefined): Tone | null {
  switch (fill) {
    case "none":
      return null;
    case "solid":
      return tone(color ?? "ink");
    case "semi":
    default:
      return color === undefined ? tone("ground") : tone(color, WASH);
  }
}

/** The ink words are set in at `amount`: the fill's ground on a solid one, the ink otherwise. */
function wordsTone(ground: Tone | null, fill: CanvasFill, amount: number): Tone {
  return fill === "solid" && ground !== null ? tone("ground", amount, ground) : tone("ink", amount);
}

/** An item's look, as both projections paint it. */
export function itemPaint(item: CanvasNode): ItemPaint {
  const style = styleOf(item);
  // A line is its outline: drawn as heavy as an edge, never filled while it runs open.
  const width = (isPathNode(item) ? LINE_WIDTHS : STROKE_WIDTHS)[style.size];
  const outline =
    style.dash === "none"
      ? null
      : { dash: style.dash, width, pattern: dashPattern(style.dash, width) };
  const open = isOpenLine(item);
  const inks = KIND_INKS[item.type] ?? OTHER_INKS;
  const fill = open ? "none" : style.fill;
  const ground = groundTone(fill, style.color);
  const stroke = style.color === undefined ? tone("ink", inks.outline) : tone(style.color);
  return {
    chrome: drawsGround(item) ? { fill, ground, outline, stroke } : null,
    words: ownsWords(item)
      ? {
          step: TYPE_STEPS[style.size],
          face: FONT_FACES[style.font],
          font: style.font,
          align: style.align,
          valign: style.valign,
        }
      : null,
    heads: open ? { length: HEAD_LENGTHS[style.size] } : null,
    opacity: style.opacity,
    ink: { words: wordsTone(ground, fill, inks.words), hint: wordsTone(ground, fill, inks.hint) },
  };
}

/** Everything a painter needs of an edge's look. */
export interface EdgePaint {
  /** Its line; null for none (`dash: "none"`), its heads and label standing alone. */
  readonly line: OutlinePaint | null;
  /** How heavy its line is, and its stroked heads (a chevron, a bar), drawn or not. */
  readonly width: number;
  /** How long its heads are (`edgeHead`). */
  readonly headLength: number;
  readonly opacity: number;
  /** The ink its line and heads are drawn in. */
  readonly ink: Tone;
}

/** How an edge stands: selected, and whether the field a native link names is gone from its node. */
export interface EdgeState {
  readonly selected: boolean;
  readonly unbound: boolean;
}

/**
 * The ink an edge is drawn in: its colour; else faint while its field is
 * gone, the primary while selected, the ink at rest.
 */
function edgeInk(color: CanvasPaint | undefined, { selected, unbound }: EdgeState): Tone {
  if (color !== undefined) return tone(color);
  if (unbound) return tone("ink", EDGE_INK.unbound);
  return selected ? tone("primary") : tone("ink", EDGE_INK.rest);
}

/** An edge's look, as both projections paint it; a selected edge is drawn a little heavier. */
export function edgePaint(edge: CanvasEdge, state: EdgeState): EdgePaint {
  const style = styleOf(edge);
  const width = LINE_WIDTHS[style.size] + (state.selected ? SELECTED_WIDEN : 0);
  return {
    ink: edgeInk(style.color, state),
    line:
      style.dash === "none"
        ? null
        : { dash: style.dash, width, pattern: dashPattern(style.dash, width) },
    width,
    headLength: HEAD_LENGTHS[style.size],
    opacity: style.opacity,
  };
}

/** How words aligned `align` sit across a line, as CSS and a canvas both say it. */
export const TEXT_ALIGNS = {
  start: "left",
  middle: "center",
  end: "right",
} as const satisfies { readonly [A in CanvasAlign]: "left" | "center" | "right" };

/** Where flexed content sits along an axis for each alignment, as CSS says it. */
export const FLEX_PLACES = {
  start: "flex-start",
  middle: "center",
  end: "flex-end",
  top: "flex-start",
  bottom: "flex-end",
} as const satisfies { readonly [A in CanvasAlign | CanvasVAlign]: string };
