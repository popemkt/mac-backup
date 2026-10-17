/**
 * An item's look in the DOM (`itemPaint` as CSS): its outline's path data,
 * every tone it is painted in (`toneCss`), the tokens its words are set in,
 * and where they sit. The 2D chrome (`ItemOutline`), every kind's words and
 * the edges read these, so a look is turned into CSS once.
 */
import type { CSSProperties } from "react";
import { itemOutline, svgPathData, type CanvasNode } from "@kb/canvas";
import { cornerRadius, readCornerRadii } from "./canvas-card-face";
import { paintCss } from "./canvas-color";
import {
  FLEX_PLACES,
  TEXT_ALIGNS,
  TONE_TOKENS,
  type Tone,
  type ToneSource,
  type WordsPaint,
} from "./canvas-style";

/** A tone's source as a CSS colour: its token, or its paint's. */
function sourceCss(of: ToneSource): string {
  return typeof of === "string" ? `var(${TONE_TOKENS[of]})` : (paintCss(of) ?? "currentColor");
}

/** A tone as CSS: its share of its source mixed over what it lies on, in sRGB as the DOM composites. */
export function toneCss(tone: Tone): string {
  const of = sourceCss(tone.of);
  if (tone.amount >= 1) return of;
  const over = tone.over === undefined ? sourceCss("ground") : toneCss(tone.over);
  return `color-mix(in srgb, ${of} ${Math.round(tone.amount * 1000) / 10}%, ${over})`;
}

/** The custom property the ink words are set in is said through (`inkStyle`). */
export const INK_PROPERTY = "--canvas-ink";

/**
 * Words set in `tone`: said through `INK_PROPERTY`, which keeps the
 * `color-mix` as written in every engine — one a CSS engine short of
 * `color-mix` (the probes' DOM) would otherwise drop from `color`, leaving
 * the words in whatever they inherit.
 */
export function inkStyle(tone: Tone): CSSProperties & { readonly [INK_PROPERTY]: string } {
  return { [INK_PROPERTY]: toneCss(tone), color: `var(${INK_PROPERTY})` };
}

/** An item's outline as SVG path data in its own box: what its chrome draws and its footprint clips. */
export function outlinePath(item: CanvasNode): string {
  return svgPathData(
    itemOutline(item, item.width, item.height, cornerRadius(item, readCornerRadii())),
  );
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
