/**
 * The edge of a scene: no scene shows a frame, so every edge fades into the
 * page. The fade is painted into the canvas (the glow's dither carries it,
 * where a CSS mask would band on a dark ground) and applied to every actor
 * where it stands, so a bat leaving the frame dissolves instead of being cut.
 */
import type { BackdropDirection } from "@kb/model";
import { smoothstep } from "./math.ts";

export interface Feather {
  /** 0 at the edge of the frame … 1 well inside it. */
  readonly at: (x: number, y: number) => number;
}

/** Smoother than smoothstep at both ends, so a fade has no visible start. */
function ease(low: number, high: number, value: number): number {
  const t = smoothstep(low, high, value);
  return t * t * (3 - 2 * t);
}

/**
 * The feather of a `width`×`height` frame: fades over a long share of each
 * side, and a longer one on the side the scene opens into the page (below
 * for a `down` backdrop, above for `up`). The page's reading column is on
 * the left, so the scene also keeps low contrast there: a scene never sits
 * behind the words at full strength.
 */
export function featherOf(width: number, height: number, direction: BackdropDirection): Feather {
  const side = width * 0.24;
  const near = height * 0.22;
  const far = height * 0.5;
  const top = direction === "down" ? near : far;
  const bottom = direction === "down" ? far : near;
  return {
    at: (x, y) =>
      ease(0, side, x) *
      ease(width, width - side, x) *
      ease(0, top, y) *
      ease(height, height - bottom, y) *
      (0.25 + 0.75 * ease(width * 0.1, width * 0.4, x)),
  };
}
