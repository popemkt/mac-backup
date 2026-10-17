/**
 * Seeded randomness: a scene's chance is reproducible from its seed, so a
 * still composition is the same every time and a test can pin one.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  readonly next: () => number;
  readonly range: (low: number, high: number) => number;
  readonly chance: (probability: number) => boolean;
  readonly int: (low: number, high: number) => number;
  /** Roughly normal, mean 0, deviation 1. */
  readonly gauss: () => number;
}

/** mulberry32: small, fast and well mixed. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (low, high) => low + (high - low) * next(),
    chance: (probability) => next() < probability,
    int: (low, high) => low + Math.floor(next() * (high - low + 1)),
    gauss: () => next() + next() + next() + next() - 2,
  };
}

/**
 * Smooth 1-D noise in [-1, 1] for steering: a different, slowly drifting
 * value for every `seed`, never repeating over the lifetime of a page.
 */
export function seededNoise(seed: number): (t: number) => number {
  const lattice = (index: number): number => {
    const h = Math.imul(index ^ seed, 0x45d9f3b) >>> 0;
    return (Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0) / 2147483648 - 1;
  };
  return (t) => {
    const base = Math.floor(t);
    const f = t - base;
    const eased = f * f * f * (f * (f * 6 - 15) + 10);
    const from = lattice(base);
    return from + (lattice(base + 1) - from) * eased;
  };
}
