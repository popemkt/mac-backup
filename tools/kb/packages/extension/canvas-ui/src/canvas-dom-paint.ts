/**
 * An item's look in the DOM (`itemPaint` as CSS): its outline's path data,
 * the colour its ground is filled with, the ink and the tokens its words are
 * set in, and where they sit. The 2D chrome (`ItemOutline`) and every
 * kind's words read these, so a look is turned into CSS once.
 */
import type { CSSProperties } from "react";
import { itemShape, shapeOutline, svgPathData, type CanvasNode } from "@kb/canvas";
import { cornerRadius, readCornerRadii } from "./canvas-card-face";
import {
  FLEX_PLACES,
  TEXT_ALIGNS,
  type ChromePaint,
  type ItemPaint,
  type WordsPaint,
} from "./canvas-style";

/** How much of its colour a semi fill washes over the ground. */
const WASH = 14;

/** An item's outline as SVG path data in its own box: what its chrome draws and its footprint clips. */
export function outlinePath(item: CanvasNode): string {
  return svgPathData(
    shapeOutline(itemShape(item), item.width, item.height, cornerRadius(item, readCornerRadii())),
  );
}

/** The CSS colour an item's ground is filled with, or none. */
export function fillCss(chrome: ChromePaint, color: string | undefined): string {
  switch (chrome.fill) {
    case "none":
      return "none";
    case "solid":
      return color ?? "var(--foreground)";
    case "semi":
    default:
      return color === undefined
        ? "var(--background)"
        : `color-mix(in oklab, ${color} ${WASH}%, var(--background))`;
  }
}

/** The ink an item's words are set in: the ground's on a solid fill, the foreground's otherwise. */
export function wordsInk(paint: ItemPaint, amount: number): string {
  const ink = paint.chrome?.fill === "solid" ? "var(--background)" : "var(--foreground)";
  return `color-mix(in oklab, ${ink} ${amount}%, transparent)`;
}

/**
 * Words set as `words` says: their face and step, aligned across the line;
 * `place` also lays out the box holding them, its content where the
 * alignment puts it across and up and down.
 */
export function wordsStyle(words: WordsPaint | null, place = false): CSSProperties {
  if (words === null) return {};
  return {
    fontFamily: `var(${words.face})`,
    fontSize: `var(${words.step})`,
    textAlign: TEXT_ALIGNS[words.align],
    ...(place
      ? {
          display: "flex",
          flexDirection: "column",
          justifyContent: FLEX_PLACES[words.valign],
          alignItems: FLEX_PLACES[words.align],
        }
      : {}),
  };
}
