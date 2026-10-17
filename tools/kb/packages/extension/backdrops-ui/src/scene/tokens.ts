/**
 * The browser's reading of the design-system tokens and the head's colour:
 * the one impure edge of the palette. Re-read when the appearance changes
 * (`Appearance.key`), as every canvas renderer does.
 */
import { readTokenColor, type Appearance } from "@kb/ui-sdk";
import { paletteOf, parseRgb, type Rgb, type ScenePalette, type SceneTokens } from "./palette.ts";

const FALLBACK: Rgb = { r: 128, g: 128, b: 128 };

const tokenRgb = (name: Parameters<typeof readTokenColor>[0]): Rgb =>
  parseRgb(readTokenColor(name)) ?? FALLBACK;

/**
 * Any CSS colour as sRGB. A 1×1 canvas does the conversion, so `color-mix`,
 * named colours and every authored colour space come out the same way.
 */
let probe: CanvasRenderingContext2D | null | undefined;
function probeContext(): CanvasRenderingContext2D | null {
  if (probe === undefined) {
    probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  }
  return probe;
}

function resolveColor(color: string): Rgb | null {
  const ctx = probeContext();
  if (ctx === null) return null;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "rgba(0, 0, 0, 0)";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  if (r === undefined || g === undefined || b === undefined || a === undefined || a === 0) {
    return null;
  }
  return { r, g, b };
}

/** The palette of the page as it is painted now, lit toward the head's `color`. */
export function readPalette(appearance: Appearance, color: string): ScenePalette {
  const tokens: SceneTokens = {
    background: tokenRgb("--background"),
    foreground: tokenRgb("--foreground"),
    primary: tokenRgb("--primary"),
    sun: tokenRgb("--header-sun"),
  };
  return paletteOf(tokens, resolveColor(color), appearance.dark);
}
