// Drawing with background layers: the shapes presets build their art from
// (presets.ts). Everything is a CSS gradient in a theme color, so the art
// follows the palette and its light and dark modes, and nothing is an image
// of anything. Backdrop shapes are anchored to the bottom-right corner in
// fixed pixels (see ArtSurfaceArt in presets.ts): the floating dock's band
// repeats them and must meet them seamlessly.
import type { ArtLayer } from "./presets.ts";

/** A theme token with a fallback, for art that must also look right on someone else's theme. */
export const token = (name: string, fallback: string) => `var(${name}, ${fallback})`;

/** A color at a strength, as a color-mix toward transparent. */
export const tint = (color: string, percent: number) => `color-mix(in oklab, ${color} ${percent}%, transparent)`;

/** A solid rectangle `w`×`h` px, `right` px in from the right edge and `bottom` px up from the bottom. */
export function rect(color: string, right: number, bottom: number, w: number, h: number): ArtLayer {
  return {
    image: `linear-gradient(${color}, ${color})`,
    size: `${w}px ${h}px`,
    position: `right ${right}px bottom ${bottom}px`,
    repeat: "no-repeat",
  };
}

/** A deterministic random sequence in [0, 1), so the art is the same on every load and in every test. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

export interface Building {
  /** Distance of its right edge from the surface's right edge (px). */
  readonly right: number;
  readonly width: number;
  readonly height: number;
}

/** A row of buildings across `span` px from the right, each `minW`–`maxW` wide and `minH`–`maxH` tall, with gaps of up to `gap`. */
export function skyline(
  seed: number,
  span: number,
  { minW, maxW, minH, maxH, gap }: { readonly minW: number; readonly maxW: number; readonly minH: number; readonly maxH: number; readonly gap: number },
): ReadonlyArray<Building> {
  const next = seeded(seed);
  const between = (low: number, high: number) => Math.round(low + next() * (high - low));
  const out: Array<Building> = [];
  for (let right = between(0, gap); right < span; ) {
    const width = between(minW, maxW);
    out.push({ right, width, height: between(minH, maxH) });
    right += width + between(0, gap);
  }
  return out;
}

/** Lit windows: a column of short dashes in `color` up a building's face, `inset` px below its roof. */
export function windows(color: string, building: Building, offset: number, inset: number): ArtLayer {
  return {
    image: `repeating-linear-gradient(to top, transparent 0 5px, ${color} 5px 7px)`,
    size: `2px ${Math.max(0, building.height - inset)}px`,
    position: `right ${building.right + offset}px bottom 0px`,
    repeat: "no-repeat",
  };
}

/** An L-shaped corner bracket of `arm` px arms and `weight` px strokes, its corner `right`/`bottom` px in. */
export function bracket(color: string, right: number, bottom: number, arm: number, weight: number): ReadonlyArray<ArtLayer> {
  return [rect(color, right, bottom, arm, weight), rect(color, right, bottom, weight, arm)];
}
