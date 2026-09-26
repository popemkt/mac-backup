/**
 * Shading arithmetic, stated once and run twice (Lab principle L2).
 *
 * A curve or a light that decides what may cross the bloom threshold is
 * written once, against this small interface, over a colour type V and a
 * scalar type S. The material runs it as TSL nodes (`NODE_OPS` in
 * `@/scene/gpu/tsl`); a test, or a CPU solver, runs the same function over
 * plain numbers (`NUMBER_OPS`, here). There is no second copy of the formula
 * to drift: what the test proves is what the shader draws. Embers' heat curve
 * and the 3D graph's node light both stand on it.
 */

export type Rgb = readonly [number, number, number];

/**
 * The bloom threshold (L2): the one value the stage's bloom pass and every
 * formula that decides what may glow agree on. Only light above it blooms.
 */
export const BLOOM_THRESHOLD = 1;

/** The arithmetic a shading formula may use, over colours V and scalars S. */
export interface ShadeOps<V, S> {
  readonly num: (value: number) => S;
  readonly add: (a: S, b: S) => S;
  readonly mul: (a: S, b: S) => S;
  readonly max: (a: S, b: S) => S;
  readonly min: (a: S, b: S) => S;
  readonly smoothstep: (from: number, to: number, t: S) => S;
  readonly mix: (a: V, b: V, t: S) => V;
  readonly scale: (v: V, s: S) => V;
  /** Channel by channel, by a constant colour. */
  readonly tint: (v: V, rgb: Rgb) => V;
  readonly addColor: (a: V, b: V) => V;
  readonly subColor: (a: V, b: V) => V;
  readonly divColor: (a: V, b: V) => V;
  readonly minColor: (a: V, b: V) => V;
  readonly maxColor: (a: V, b: V) => V;
  /** The least of a colour's three channels. */
  readonly minChannel: (v: V) => S;
  readonly white: V;
  readonly black: V;
}

function smooth(from: number, to: number, t: number): number {
  const x = Math.max(0, Math.min(1, (t - from) / (to - from)));
  return x * x * (3 - 2 * x);
}

const each = (f: (c: 0 | 1 | 2) => number): Rgb => [f(0), f(1), f(2)];

/** The arithmetic on plain numbers: linear RGB triples and numbers. */
export const NUMBER_OPS: ShadeOps<Rgb, number> = {
  num: (value) => value,
  add: (a, b) => a + b,
  mul: (a, b) => a * b,
  max: Math.max,
  min: Math.min,
  smoothstep: smooth,
  mix: (a, b, t) => each((c) => a[c] + (b[c] - a[c]) * t),
  scale: (v, s) => each((c) => v[c] * s),
  tint: (v, rgb) => each((c) => v[c] * rgb[c]),
  addColor: (a, b) => each((c) => a[c] + b[c]),
  subColor: (a, b) => each((c) => a[c] - b[c]),
  divColor: (a, b) => each((c) => a[c] / b[c]),
  minColor: (a, b) => each((c) => Math.min(a[c], b[c])),
  maxColor: (a, b) => each((c) => Math.max(a[c], b[c])),
  minChannel: (v) => Math.min(v[0], v[1], v[2]),
  white: [1, 1, 1],
  black: [0, 0, 0],
};
