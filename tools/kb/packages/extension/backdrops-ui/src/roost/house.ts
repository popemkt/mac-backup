/**
 * The house of Roost: a long overhang over the bats, a wall under its right
 * end, a post and brace at its left, a small window. All of it is drawn in
 * the page's own tone (`../scene/draw-figure`), so it is the light behind it
 * that draws the house: the sun or moon sits under the overhang, and the
 * eave line, the post and the roof's underside are cut out of it. Only the
 * eave is crisp, because it is where the bats hold; the roof dissolves
 * upward and the wall and post dissolve away from it, so nothing ends in a
 * straight line. Pure geometry, in the frame's CSS pixels.
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

/** A shape with a fade: the page's tone at `from` going to nothing at `to`. */
export interface Faded {
  readonly poly: Poly;
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}

export interface House {
  /** The roof slab: crisp at the eave, dissolving upward. */
  readonly roof: Faded;
  /** The wall at the right: dissolving toward the overhang and downward. */
  readonly wall: Faded;
  /** The post at the overhang's end, dissolving downward, and its curved brace. */
  readonly post: Faded;
  readonly brace: Poly;
  /** The beam under the roof's edge, and the rafter tails: crisp, since the bats hold on to them. */
  readonly crisp: Poly[];
  readonly window: Casement;
  /** The y of the line bats hang from, and the stretch of it they may use. */
  readonly eave: { readonly y: number; readonly from: number; readonly to: number };
  readonly glow: GlowSpec;
}

function rect(x: number, y: number, width: number, height: number): Poly {
  return [x, y, x + width, y, x + width, y + height, x, y + height];
}

/** The brace: a slim curve from the post at (x, y) rising to the beam, as a thin closed shape. */
function braceFrom(x: number, y: number, reach: number, rise: number): Poly {
  const out: Poly = [];
  const steps = 8;
  const along = (t: number) => ({ x: x + reach * t, y: y - rise * Math.sin((t * Math.PI) / 2) });
  for (let i = 0; i <= steps; i++) {
    const p = along(i / steps);
    out.push(p.x, p.y);
  }
  for (let i = steps; i >= 0; i--) {
    const p = along(i / steps);
    out.push(p.x, p.y + 3.2);
  }
  return out;
}

/** The house for a `width`×`height` frame; the eave sits high for `down`, low for `up`. */
export function houseOf(
  width: number,
  height: number,
  direction: BackdropDirection,
  dark: boolean,
): House {
  const eaveY = height * (direction === "down" ? 0.34 : 0.62);
  const roofStart = width * 0.29;
  const wallStart = width * 0.7;
  const fascia = 6;
  const edge = eaveY + fascia;
  const topNear = eaveY - height * 0.14;
  const topFar = eaveY - height * 0.3;
  const rafters: Poly[] = [];
  for (let x = roofStart + 24; x < wallStart - 10; x += 46) rafters.push(rect(x, edge, 4.5, 9));
  const beam = rect(roofStart - 12, eaveY, width + 52 - roofStart, fascia + 1);
  const postX = roofStart - 4;
  return {
    roof: {
      poly: [roofStart - 14, topNear, width + 40, topFar, width + 40, edge, roofStart - 14, edge],
      from: { x: roofStart + width * 0.3, y: edge },
      to: { x: roofStart - width * 0.02, y: topFar - height * 0.08 },
    },
    wall: {
      poly: rect(wallStart, edge, width - wallStart + 20, height * 0.42),
      from: { x: width, y: edge },
      to: { x: wallStart - width * 0.02, y: edge + height * 0.38 },
    },
    post: {
      poly: [
        postX,
        edge,
        postX + 4.5,
        edge,
        postX + 3.8,
        edge + height * 0.4,
        postX + 0.7,
        edge + height * 0.4,
      ],
      from: { x: 0, y: edge + 6 },
      to: { x: 0, y: edge + height * 0.36 },
    },
    brace: braceFrom(postX + 4, edge + 36, 32, 34),
    crisp: [beam, ...rafters],
    window: {
      x: width * 0.86,
      y: edge + height * 0.12,
      width: Math.max(18, width * 0.022),
      height: Math.max(26, width * 0.032),
    },
    eave: { y: edge, from: roofStart + 52, to: wallStart - 24 },
    glow: {
      x: width * 0.47,
      y: eaveY + height * (dark ? 0.15 : 0.13),
      reach: width * 0.56,
      disc: (dark ? 32 : 38) * Math.min(1, width / 800),
      squash: 1.7,
      power: dark ? 4.2 : 3,
      intensity: dark ? 1 : 1.4,
      washFrom: direction === "down" ? "top" : "bottom",
    },
  };
}
