/**
 * Embers' heat-to-light curve, stated once (Lab principle L2).
 *
 * `heatEmissive` and `displayTemperature` are written over the scene kit's
 * shading arithmetic (`@/scene/shade-ops`), so the one definition runs twice:
 * as TSL nodes in the sphere material, and as numbers on the CPU, where
 * `restCeiling` asks it how warm the resting glow may be before any channel
 * of any sphere's emissive crosses the bloom threshold.
 *
 * The cap lives where the colour is made. The shown temperature is the
 * contact heat or the capped resting glow, whichever is warmer, and the cap
 * is solved every frame from the accent and gain that frame is shaded with —
 * the eased accent mid-theme-change, the new gain on a frozen still — so no
 * frame, stepped or not, can let a resting sphere bloom.
 *
 * The curve: a blackbody-style ramp through the palette — dark maroon, the
 * accent's ember, the accent, the accent run toward white — under a gain
 * that grows with t², so a warm rest stays under the threshold and only
 * contact heat crosses it; past t ≈ 0.85 the hot end runs far into HDR (the
 * halo). A small maroon floor keeps the coolest sphere a colour (L1).
 */

import { BLOOM_THRESHOLD, NUMBER_OPS, type Rgb, type ShadeOps } from "@/scene/shade-ops";

export type { Rgb };

/** The accent's ember: its red kept, its green and blue sunk. */
export const EMBER_TINT: Rgb = [0.85, 0.28, 0.12];
const MAROON = 0.35;
const HOT_WHITE = 0.6;
const LINEAR = 0.15;
const HALO_FROM = 0.85;
const HALO_TO = 1.3;
const HALO = 5;
const FLOOR = 0.2;

/** The emissive gain by theme: a night sky can carry more light than a day one. */
export const HEAT_GAIN = { dark: 3.2, light: 2.4 } as const;

/** The emissive colour of a sphere at temperature `t` (0 cold, 1 pop, 1.6 flash). */
export function heatEmissive<V, S>(o: ShadeOps<V, S>, accent: V, t: S, gain: S): V {
  const ember = o.tint(accent, EMBER_TINT);
  const maroon = o.scale(ember, o.num(MAROON));
  const hot = o.mix(accent, o.white, o.num(HOT_WHITE));
  const ramp = o.mix(
    o.mix(maroon, ember, o.smoothstep(0, 0.35, t)),
    o.mix(accent, hot, o.smoothstep(0.7, 1, t)),
    o.smoothstep(0.3, 0.7, t),
  );
  const level = o.add(
    o.add(o.mul(o.mul(t, t), gain), o.mul(t, o.num(LINEAR))),
    o.mul(o.smoothstep(HALO_FROM, HALO_TO, t), o.num(HALO)),
  );
  return o.addColor(o.scale(ramp, level), o.scale(maroon, o.num(FLOOR)));
}

/**
 * A sphere's surface colour at temperature `t`, before its emissive, in the
 * theme it is shown in (Lab principles L1, P5). `daylight` is 0 on a dark
 * ground and 1 on a light one.
 *
 * On a dark ground the surface stays a deep ember, so the emissive ramp is
 * what reads; on a light ground an emissive barely shows, so the ramp moves
 * into the surface: a cold sphere is pale ash (the ground run toward the hue
 * family), warming through the accent's ember to the accent, and only the
 * hot end's emissive, as in the dark, crosses the bloom threshold. Both
 * ramps are drawn from the `--lab-*` tokens of the theme on screen; the study
 * never forces a dark stage, which would paint colours no light-theme token
 * names.
 */
export function heatAlbedo<V, S>(
  o: ShadeOps<V, S>,
  palette: { readonly ground: V; readonly hue: V; readonly accent: V },
  t: S,
  daylight: S,
): V {
  const ember = o.tint(palette.accent, EMBER_TINT);
  const night = o.mix(o.scale(ember, o.num(0.3)), o.scale(palette.hue, o.num(0.2)), o.num(0.3));
  const ash = o.mix(palette.ground, palette.hue, o.num(0.28));
  const day = o.mix(
    o.mix(ash, ember, o.smoothstep(0.05, 0.5, t)),
    palette.accent,
    o.smoothstep(0.45, 0.9, t),
  );
  return o.mix(night, day, daylight);
}

/**
 * The temperature a sphere is shown at: its contact heat (and a pop's flash),
 * or its resting glow capped at `ceiling`, whichever is warmer.
 */
export function displayTemperature<V, S>(o: ShadeOps<V, S>, contact: S, rest: S, ceiling: S): S {
  return o.max(contact, o.min(rest, ceiling));
}

/** The brightest channel of the emissive at `t`. */
export function peakEmissive(accent: Rgb, gain: number, t: number): number {
  return Math.max(...heatEmissive(NUMBER_OPS, accent, t, gain));
}

/** Every resting sphere stays under the bloom threshold by a hair of margin. */
const MARGIN = 0.98;

/**
 * The warmest resting temperature whose emissive stays under the bloom
 * threshold in every channel, for this (linear) accent and gain: the first
 * crossing, found by scanning up from cold and refining by bisection.
 */
export function restCeiling(accent: Rgb, gain: number, limit = 1): number {
  const ok = (t: number) => peakEmissive(accent, gain, t) <= BLOOM_THRESHOLD * MARGIN;
  const steps = 200;
  let low = 0;
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * limit;
    if (!ok(t)) {
      let high = t;
      for (let k = 0; k < 30; k++) {
        const mid = (low + high) / 2;
        if (ok(mid)) low = mid;
        else high = mid;
      }
      return low;
    }
    low = t;
  }
  return limit;
}

/**
 * `restCeiling`, solved again only when the accent or gain it was solved for
 * has moved: the frame loop asks every frame, and a still palette costs
 * nothing (P3).
 */
export class RestCeiling {
  value = 0;
  private r = Number.NaN;
  private g = Number.NaN;
  private b = Number.NaN;
  private gain = Number.NaN;

  /** The ceiling for this linear accent and gain. */
  for(
    accent: { readonly r: number; readonly g: number; readonly b: number },
    gain: number,
  ): number {
    if (accent.r !== this.r || accent.g !== this.g || accent.b !== this.b || gain !== this.gain) {
      this.r = accent.r;
      this.g = accent.g;
      this.b = accent.b;
      this.gain = gain;
      this.value = restCeiling([accent.r, accent.g, accent.b], gain);
    }
    return this.value;
  }
}

/** The brightest channel a sphere is shown at, with the cap the frame would solve. */
export function peakShown(accent: Rgb, gain: number, contact: number, rest: number): number {
  const shown = displayTemperature(NUMBER_OPS, contact, rest, restCeiling(accent, gain));
  return peakEmissive(accent, gain, shown);
}
