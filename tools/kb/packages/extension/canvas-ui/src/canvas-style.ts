/**
 * An item's or an edge's look as both projections paint it (`itemPaint`,
 * `edgePaint`): `styleOf`'s looks turned into what a painter draws with — a
 * line's width and dash pattern in canvas units, the type step and face
 * words are set in (as design tokens), where they sit, a fill, the length of
 * an edge's heads, and an opacity. The DOM canvas and the 3D scene read only
 * this, so a look means one thing in both, and the look contract holds them
 * to it.
 */
import {
  drawsGround,
  isOpenLine,
  isPathNode,
  ownsWords,
  styleOf,
  type CanvasAlign,
  type CanvasDash,
  type CanvasEdge,
  type CanvasFill,
  type CanvasFont,
  type CanvasNode,
  type CanvasPaint,
  type CanvasSize,
  type CanvasVAlign,
} from "@kb/canvas";

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
  /** Null for no outline at all. */
  readonly outline: OutlinePaint | null;
}

/** Everything a painter needs of an item's look. */
export interface ItemPaint {
  readonly color: CanvasPaint | undefined;
  /** Null for an item that draws no ground of its own (`drawsGround`): a picture. */
  readonly chrome: ChromePaint | null;
  /** Null for an item whose words are not its own (`ownsWords`): a card's, a picture. */
  readonly words: WordsPaint | null;
  /** How long the heads its ends wear are (`pathHeads`); null for an item with no ends. */
  readonly heads: { readonly length: number } | null;
  readonly opacity: number;
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
  return {
    color: style.color,
    chrome: drawsGround(item) ? { fill: open ? "none" : style.fill, outline } : null,
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
  };
}

/** Everything a painter needs of an edge's look. */
export interface EdgePaint {
  readonly color: CanvasPaint | undefined;
  /** Its line; null for none (`dash: "none"`), its heads and label standing alone. */
  readonly line: OutlinePaint | null;
  /** How heavy its line is, and its stroked heads (a chevron, a bar), drawn or not. */
  readonly width: number;
  /** How long its heads are (`edgeHead`). */
  readonly headLength: number;
  readonly opacity: number;
}

/** An edge's look, as both projections paint it; a selected edge is drawn a little heavier. */
export function edgePaint(edge: CanvasEdge, selected: boolean): EdgePaint {
  const style = styleOf(edge);
  const width = LINE_WIDTHS[style.size] + (selected ? SELECTED_WIDEN : 0);
  return {
    color: style.color,
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
} as const satisfies { readonly [A in CanvasAlign]: CanvasTextAlign };

/** Where flexed content sits along an axis for each alignment, as CSS says it. */
export const FLEX_PLACES = {
  start: "flex-start",
  middle: "center",
  end: "flex-end",
  top: "flex-start",
  bottom: "flex-end",
} as const satisfies { readonly [A in CanvasAlign | CanvasVAlign]: string };
