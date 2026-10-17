/**
 * A look said in CSS (`paint.ts`'s `Tone`s and paints as the colours a
 * painter writes): each palette entry's design token
 * (`--canvas-color-<id>`, on :root and .dark), a paint as the colour it is
 * drawn in, and a tone as its share of its source mixed over what it lies
 * on. Every painter that writes CSS colours reads these, the DOM canvas and
 * the SVG export alike, so a tone is turned into CSS once.
 */
import { TONE_TOKENS, type Tone, type ToneSource } from "./paint.ts";
import type { CanvasPaint, CanvasPaletteId } from "./style.ts";

/** The token a palette entry is drawn in, in every projection. */
export function paletteToken(id: CanvasPaletteId) {
  return `--canvas-color-${id}` as const;
}

/** A paint as a CSS colour, or undefined for none. A literal colour passes through as written. */
export function paintCss(paint: CanvasPaint | undefined): string | undefined {
  if (paint === undefined) return undefined;
  return paint.kind === "palette" ? `var(${paletteToken(paint.id)})` : paint.css;
}

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
