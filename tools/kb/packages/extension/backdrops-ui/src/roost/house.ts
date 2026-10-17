/**
 * The house of Roost: a roofline with a long overhang, a wall under its
 * left end, a chimney, a post, a window. All of it is drawn in the page's own
 * tone (`../scene/draw-figure`), so it is the light behind it that draws the
 * house: the sun or moon sits under the overhang, and the roof, the post and
 * the wall's edge are cut out of it. Pure geometry, in the frame's CSS pixels.
 */
import type { BackdropDirection } from "@kb/model";
import type { Poly } from "../scene/figure";
import type { GlowSpec } from "../scene/glow";

interface Casement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface House {
  /** Roof slab with its fascia, rafter tails and chimney: closed shapes. */
  readonly roof: Poly[];
  /** The wall under the roof's left end: it dissolves downward, so it has no foot. */
  readonly wall: Poly;
  /** The post at the overhang's end and its brace. */
  readonly posts: Poly[];
  readonly window: Casement;
  /** The y of the line bats hang from, and the stretch of it they may use. */
  readonly eave: { readonly y: number; readonly from: number; readonly to: number };
  readonly glow: GlowSpec;
}

function rect(x: number, y: number, width: number, height: number): Poly {
  return [x, y, x + width, y, x + width, y + height, x, y + height];
}

/** The house for a `width`×`height` frame; the eave sits high for `down`, low for `up`. */
export function houseOf(
  width: number,
  height: number,
  direction: BackdropDirection,
  dark: boolean,
): House {
  const eaveY = height * (direction === "down" ? 0.34 : 0.62);
  const roofEnd = width * 0.84;
  const wallEnd = width * 0.3;
  const topLeft = eaveY - height * 0.24;
  const topRight = eaveY - height * 0.12;
  const fascia = 7;
  const slope = (x: number) => topLeft + ((topRight - topLeft) * (x + 40)) / (roofEnd + 40);
  const rafters: Poly[] = [];
  for (let x = 18; x < roofEnd - 14; x += 44) {
    rafters.push(rect(x, eaveY + fascia, 5, 10));
  }
  const chimneyX = width * 0.2;
  const chimneyTop = slope(chimneyX) - height * 0.17;
  const roof: Poly[] = [
    [-40, topLeft, roofEnd, topRight, roofEnd + 12, eaveY + fascia, -40, eaveY + fascia],
    ...rafters,
    rect(chimneyX, chimneyTop, 26, slope(chimneyX) - chimneyTop + 4),
    rect(chimneyX - 4, chimneyTop - 6, 34, 7),
  ];
  const post = rect(roofEnd - 8, eaveY + fascia, 7, height * 0.34);
  const brace: Poly = [
    roofEnd - 8,
    eaveY + fascia + 36,
    roofEnd - 44,
    eaveY + fascia,
    roofEnd - 34,
    eaveY + fascia,
    roofEnd - 1,
    eaveY + fascia + 46,
  ];
  const wall = rect(8, eaveY + fascia, wallEnd - 8, height * 0.4);
  const window: Casement = {
    x: width * 0.13,
    y: eaveY + height * 0.1,
    width: Math.max(30, width * 0.04),
    height: Math.max(40, width * 0.052),
  };
  return {
    roof,
    wall,
    posts: [post, brace],
    window,
    eave: { y: eaveY + fascia, from: width * 0.33, to: roofEnd - 52 },
    glow: {
      x: width * 0.64,
      y: eaveY + height * (dark ? 0.16 : 0.14),
      reach: width * 0.62,
      disc: (dark ? 34 : 40) * Math.min(1, width / 800),
      squash: 1.7,
      intensity: 1,
      washFrom: direction === "down" ? "top" : "bottom",
    },
  };
}
