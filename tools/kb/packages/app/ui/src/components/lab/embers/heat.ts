/**
 * Embers' heat-to-light curve, stated once (Lab principle L2).
 *
 * `heatEmissive` and `displayTemperature` are written over a small
 * arithmetic interface, so the one definition runs twice: as TSL nodes in the
 * sphere material, and as numbers on the CPU, where `restCeiling` asks it how
 * warm the resting glow may be before any channel of any sphere's emissive
 * crosses the bloom threshold.
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

/** The arithmetic the curve needs, over a colour type V and a scalar type S. */
export interface HeatOps<V, S> {
  readonly num: (value: number) => S;
  readonly add: (a: S, b: S) => S;
  readonly max: (a: S, b: S) => S;
  readonly min: (a: S, b: S) => S;
  readonly mul: (a: S, b: S) => S;
  readonly smoothstep: (from: number, to: number, t: S) => S;
  readonly mix: (a: V, b: V, t: S) => V;
  readonly scale: (v: V, s: S) => V;
  readonly tint: (v: V, rgb: Rgb) => V;
  readonly addColor: (a: V, b: V) => V;
  readonly white: V;
}

export type Rgb = readonly [number, number, number];

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
export function heatEmissive<V, S>(o: HeatOps<V, S>, accent: V, t: S, gain: S): V {
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
 * The temperature a sphere is shown at: its contact heat (and a pop's flash),
 * or its resting glow capped at `ceiling`, whichever is warmer.
 */
export function displayTemperature<V, S>(o: HeatOps<V, S>, contact: S, rest: S, ceiling: S): S {
  return o.max(contact, o.min(rest, ceiling));
}

function smooth(from: number, to: number, t: number): number {
  const x = Math.max(0, Math.min(1, (t - from) / (to - from)));
  return x * x * (3 - 2 * x);
}

/** The curve's arithmetic on plain numbers: linear RGB triples. */
const NUMBER_OPS: HeatOps<Rgb, number> = {
  num: (value) => value,
  add: (a, b) => a + b,
  max: Math.max,
  min: Math.min,
  mul: (a, b) => a * b,
  smoothstep: smooth,
  mix: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  scale: (v, s) => [v[0] * s, v[1] * s, v[2] * s],
  tint: (v, rgb) => [v[0] * rgb[0], v[1] * rgb[1], v[2] * rgb[2]],
  addColor: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  white: [1, 1, 1],
};

/** The brightest channel of the emissive at `t`. */
export function peakEmissive(accent: Rgb, gain: number, t: number): number {
  return Math.max(...heatEmissive(NUMBER_OPS, accent, t, gain));
}

/** The bloom threshold every resting sphere stays under, with a hair of margin. */
const THRESHOLD = 1;
const MARGIN = 0.98;

/**
 * The warmest resting temperature whose emissive stays under the bloom
 * threshold in every channel, for this (linear) accent and gain: the first
 * crossing, found by scanning up from cold and refining by bisection.
 */
export function restCeiling(accent: Rgb, gain: number, limit = 1): number {
  const ok = (t: number) => peakEmissive(accent, gain, t) <= THRESHOLD * MARGIN;
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
