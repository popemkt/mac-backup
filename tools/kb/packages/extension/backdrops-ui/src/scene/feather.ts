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

/**
 * The feather of a `width`×`height` frame: fades over a share of each side,
 * and a longer one on the side the scene opens into the page (below for a
 * `down` backdrop, above for `up`).
 */
export function featherOf(width: number, height: number, direction: BackdropDirection): Feather {
  const side = width * 0.16;
  const near = height * 0.12;
  const far = height * 0.4;
  const top = direction === "down" ? near : far;
  const bottom = direction === "down" ? far : near;
  return {
    at: (x, y) =>
      smoothstep(0, side, x) *
      smoothstep(width, width - side, x) *
      smoothstep(0, top, y) *
      smoothstep(height, height - bottom, y),
  };
}
