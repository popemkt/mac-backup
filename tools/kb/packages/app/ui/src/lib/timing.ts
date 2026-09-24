/**
 * The timing vocabulary of script motion (Lab principles M1, M2, M6): the
 * durations and ease in `motion.css`, read once from the tokens, and the two
 * ways anything moves toward a target — a critically damped spring, or a
 * frame-rate-independent exponential approach. No scene or renderer types a
 * duration. (Whether motion may run at all is `motion.ts`'s question.)
 */

export interface CubicBezier {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface Timing {
  /** `--motion-settle`, the one ease. */
  readonly settle: CubicBezier;
  /** Seconds. */
  readonly quick: number;
  readonly reveal: number;
  readonly theme: number;
  readonly arrive: number;
  /** How long a pointer-follow spring takes to settle (M5: 300–600ms). */
  readonly follow: number;
  /** Delay between neighbours in a staggered wave (M3). */
  readonly stagger: number;
  /** The shortest period an ambient motion may have (M4). */
  readonly ambientPeriod: number;
}

/**
 * What `readTiming` answers when no stylesheet is loaded (a unit test, a
 * detached document). It is the one TS mirror of `motion.css`, and
 * `timing.test.ts` fails if the two ever disagree.
 */
export const TIMING_FALLBACK: Timing = {
  settle: { x1: 0.22, y1: 1, x2: 0.36, y2: 1 },
  quick: 0.22,
  reveal: 0.28,
  theme: 0.36,
  arrive: 0.9,
  follow: 0.48,
  stagger: 0.024,
  ambientPeriod: 12,
};

/** `cubic-bezier(a, b, c, d)` → its control points, or null. */
export function parseCubicBezier(value: string): CubicBezier | null {
  const match = /^cubic-bezier\(([^)]*)\)$/.exec(value.trim());
  const parts = match?.[1]?.split(",").map((part) => Number.parseFloat(part));
  if (parts?.length !== 4 || parts.some(Number.isNaN)) return null;
  const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] = parts;
  return { x1, y1, x2, y2 };
}

/** A CSS time (`480ms`, `12s`) in seconds, or null. */
export function parseCssSeconds(value: string): number | null {
  const match = /^(-?[\d.]+)(ms|s)$/.exec(value.trim());
  if (match === null) return null;
  const amount = Number.parseFloat(match[1] ?? "");
  if (Number.isNaN(amount)) return null;
  return match[2] === "ms" ? amount / 1000 : amount;
}

/** The timing tokens as the document resolves them now. */
export function readTiming(): Timing {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
    return TIMING_FALLBACK;
  }
  const style = getComputedStyle(document.documentElement);
  const seconds = (token: string, fallback: number) =>
    parseCssSeconds(style.getPropertyValue(token)) ?? fallback;
  const f = TIMING_FALLBACK;
  return {
    settle: parseCubicBezier(style.getPropertyValue("--motion-settle")) ?? f.settle,
    quick: seconds("--motion-duration-quick", f.quick),
    reveal: seconds("--motion-duration-reveal", f.reveal),
    theme: seconds("--motion-duration-theme", f.theme),
    arrive: seconds("--motion-duration-arrive", f.arrive),
    follow: seconds("--motion-duration-follow", f.follow),
    stagger: seconds("--motion-stagger", f.stagger),
    ambientPeriod: seconds("--motion-ambient-period", f.ambientPeriod),
  };
}

/** A frame step is never longer than this, so a tab switch is not a leap (M2). */
const MAX_STEP = 1 / 20;

export function clampStep(seconds: number): number {
  return Math.max(0, Math.min(MAX_STEP, seconds));
}

/**
 * A critically damped spring settles to within 2% of its target at about
 * 5.83 / ω seconds; this is the ω that settles in `seconds`.
 */
export function springRate(seconds: number): number {
  return 5.83 / Math.max(0.01, seconds);
}

/** One spring: where it is and how fast it moves. Mutated in place (no per-frame garbage). */
export interface Spring {
  x: number;
  v: number;
}

/**
 * Advance a critically damped spring toward `target` by `dt`, exactly (the
 * closed form, so any frame rate gives the same path).
 */
export function stepSpring(spring: Spring, target: number, rate: number, dt: number): void {
  const offset = spring.x - target;
  const decay = Math.exp(-rate * dt);
  const drift = spring.v + rate * offset;
  spring.x = target + (offset + drift * dt) * decay;
  spring.v = (spring.v - rate * drift * dt) * decay;
}

/** A critically damped spring's step response from rest: 0 → 1. */
export function springResponse(t: number, rate: number): number {
  if (t <= 0) return 0;
  return 1 - (1 + rate * t) * Math.exp(-rate * t);
}

/** The exponential approach's rate that closes 98% of a gap in `seconds`. */
export function approachRate(seconds: number): number {
  return 3.91 / Math.max(0.01, seconds);
}

/** Frame-rate-independent `current → target` (`1 - exp(-rate·dt)` of the gap). */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

/** One axis of a unit cubic Bezier (P0 = 0, P3 = 1) at parameter t. */
function bez(t: number, a: number, b: number): number {
  return 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
}

function slope(t: number, a: number, b: number): number {
  return 3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t;
}

/** The ease's y for progress x, solved on the curve by Newton's method. */
export function easeAt(curve: CubicBezier, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const error = bez(t, curve.x1, curve.x2) - x;
    const d = slope(t, curve.x1, curve.x2);
    if (Math.abs(error) < 1e-6) break;
    if (Math.abs(d) < 1e-6) break;
    t = Math.max(0, Math.min(1, t - error / d));
  }
  return bez(t, curve.y1, curve.y2);
}
