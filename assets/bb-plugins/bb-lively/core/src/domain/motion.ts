// The motion system: one set of tokens per (style, intensity), and one easing
// family. Every effect reads these tokens (as CSS custom properties); no
// effect has a number of its own.
//
// Two orthogonal axes:
// - intensity is volume: raising it scales distance, scale, overshoot,
//   duration, blur, glow and stagger together, so subtle and bold are the
//   same system at two volumes;
// - style is shape: `clean` is one overshoot and rest; `wobbly` (after
//   Zenless Zone Zero, docs/research/2026-10-24-bb-lively-zzz-wobble.md) is a
//   fast attack with a multi-bounce settle, plus squash, skew, tilt, sticker
//   shadows, a delayed swell, a brightness flash and a chromatic split. Those
//   eight style tokens are 0 in `clean` (the sticker distance only shows when
//   stickers are switched on, see settings), so clean's sheet is unchanged.
import { Schema } from "effect";

export const INTENSITIES = ["subtle", "lively", "bold"] as const;
export const Intensity = Schema.Literals(INTENSITIES);
export type Intensity = typeof Intensity.Type;

export const STYLES = ["clean", "wobbly"] as const;
export const Style = Schema.Literals(STYLES);
export type Style = typeof Style.Type;

export interface MotionTokens {
  /** Press down (ms). Presses stay snappy at every intensity. */
  readonly pressMs: number;
  /** Press release, the spring back (ms). */
  readonly releaseMs: number;
  /** A row, page or panel arriving (ms). */
  readonly enterMs: number;
  /** A menu or dialog opening (ms); closing takes `exitMs`. */
  readonly overlayMs: number;
  readonly exitMs: number;
  /** One ring of a status pulse, one send ripple (ms). */
  readonly pulseMs: number;
  /** One breath of a breathing glow (ms); 0 means the glow holds still. */
  readonly breatheMs: number;
  /** Spring overshoot past the target, as a fraction (0.16 = 16%). Each later swing is smaller by the same ratio. */
  readonly overshoot: number;
  /** Where the spring first peaks, as a fraction of its duration: lower is a faster attack and more bounces (clean: 0.4). */
  readonly peakAt: number;
  /** How far an arriving row or page travels (px). */
  readonly rise: number;
  /** How far a hovered card rises (px). */
  readonly lift: number;
  /** Opacity of the hovered card's soft shadow (0 = none). */
  readonly liftShadow: number;
  /** Blur an arriving row or opening menu starts from (px). */
  readonly blur: number;
  /** Delay between rows arriving together (ms). */
  readonly stagger: number;
  /** Scale while pressed. */
  readonly pressScale: number;
  /** Scale a menu or dialog opens from. */
  readonly overlayScale: number;
  /** Scale a send ripple and a status ring grow to. */
  readonly rippleScale: number;
  readonly ringScale: number;
  /** How far send particles fly, as a scale of their ring (0 = no particles). */
  readonly burst: number;
  /** Strength of accent glows (focus, working, rings), 0–1. */
  readonly glow: number;
  /** Peak non-uniform squash, as a fraction (0.09 is `scale: 1.09 0.91`). */
  readonly squash: number;
  /** Skew an arriving row starts from (deg), settling to 0. */
  readonly skew: number;
  /** Rotation for hover, pops and menus (deg). */
  readonly tilt: number;
  /** Hard offset-shadow distance (px), shown only while stickers are on. */
  readonly sticker: number;
  /** The delayed swell after a snap, as a scale fraction. */
  readonly swell: number;
  /** Extra brightness on arrival (0.45 is `brightness(1.45)`). */
  readonly flash: number;
  /** Chromatic split (px). */
  readonly chroma: number;
}

/** The style tokens at rest: clean has no squash, skew, tilt, swell, flash or chroma. */
const STILL = { peakAt: 0.4, squash: 0, skew: 0, tilt: 0, swell: 0, flash: 0, chroma: 0 } as const;

const CLEAN: Readonly<Record<Intensity, MotionTokens>> = {
  subtle: {
    pressMs: 90,
    releaseMs: 160,
    enterMs: 220,
    overlayMs: 160,
    exitMs: 90,
    pulseMs: 300,
    breatheMs: 0,
    overshoot: 0.025,
    rise: 6,
    lift: 1,
    liftShadow: 0,
    blur: 0,
    stagger: 30,
    pressScale: 0.97,
    overlayScale: 0.96,
    rippleScale: 1.6,
    ringScale: 1.035,
    burst: 0,
    glow: 0.14,
    sticker: 2,
    ...STILL,
  },
  lively: {
    pressMs: 85,
    releaseMs: 220,
    enterMs: 280,
    overlayMs: 210,
    exitMs: 100,
    pulseMs: 340,
    breatheMs: 2800,
    overshoot: 0.08,
    rise: 10,
    lift: 1.5,
    liftShadow: 0.18,
    blur: 2,
    stagger: 40,
    pressScale: 0.96,
    overlayScale: 0.94,
    rippleScale: 1.9,
    ringScale: 1.06,
    burst: 1,
    glow: 0.22,
    sticker: 3,
    ...STILL,
  },
  bold: {
    pressMs: 80,
    releaseMs: 280,
    enterMs: 360,
    overlayMs: 260,
    exitMs: 120,
    pulseMs: 400,
    breatheMs: 2400,
    overshoot: 0.16,
    rise: 16,
    lift: 2,
    liftShadow: 0.3,
    blur: 4,
    stagger: 55,
    pressScale: 0.95,
    overlayScale: 0.9,
    rippleScale: 2.3,
    ringScale: 1.09,
    burst: 1.45,
    glow: 0.32,
    sticker: 4,
    ...STILL,
  },
};

/**
 * Wobbly: the design's table (§3.2). Fields it does not set (lift, shadows,
 * rings, burst, glow, breathing) are the same intensity's clean values. Edges
 * stay hard: no blur-in. Stagger is the 50 ms measured in ZZZ's results grid.
 */
const WOBBLY: Readonly<Record<Intensity, MotionTokens>> = {
  subtle: {
    ...CLEAN.subtle,
    pressMs: 70,
    releaseMs: 320,
    enterMs: 340,
    overlayMs: 300,
    exitMs: 80,
    pulseMs: 320,
    overshoot: 0.18,
    peakAt: 0.26,
    rise: 8,
    blur: 0,
    stagger: 50,
    pressScale: 0.95,
    overlayScale: 0.92,
    squash: 0.05,
    skew: -4,
    tilt: -0.6,
    sticker: 2,
    swell: 0.03,
    flash: 0.25,
    chroma: 1,
  },
  lively: {
    ...CLEAN.lively,
    pressMs: 65,
    releaseMs: 400,
    enterMs: 420,
    overlayMs: 360,
    exitMs: 80,
    pulseMs: 360,
    overshoot: 0.3,
    peakAt: 0.2,
    rise: 14,
    blur: 0,
    stagger: 50,
    pressScale: 0.93,
    overlayScale: 0.86,
    squash: 0.09,
    skew: -8,
    tilt: -1.2,
    sticker: 3,
    swell: 0.055,
    flash: 0.45,
    chroma: 2,
  },
  bold: {
    ...CLEAN.bold,
    pressMs: 60,
    releaseMs: 480,
    enterMs: 500,
    overlayMs: 420,
    exitMs: 90,
    pulseMs: 400,
    overshoot: 0.42,
    peakAt: 0.16,
    rise: 20,
    blur: 0,
    stagger: 50,
    pressScale: 0.9,
    overlayScale: 0.8,
    squash: 0.14,
    skew: -12,
    tilt: -2,
    sticker: 4,
    swell: 0.08,
    flash: 0.7,
    chroma: 3,
  },
};

/** Every token, by style and then intensity. */
export const MOTION_TOKENS: Readonly<Record<Style, Readonly<Record<Intensity, MotionTokens>>>> = { clean: CLEAN, wobbly: WOBBLY };

/** The tokens for one (style, intensity), before speed. */
export function motionTokens(style: Style, intensity: Intensity): MotionTokens {
  return MOTION_TOKENS[style][intensity];
}

/**
 * The duration budget per style, at normal speed.
 * - Presses stay snappy in both.
 * - Clean lands at its single peak and settles at once, so one cap on the
 *   total is its whole budget (land ≤ total).
 * - Wobbly's feel is its attack, not its tail: whatever springs in must first
 *   reach its target within `maxLandMs` (ZZZ snaps in within a few frames),
 *   and the settle may run to `maxTotalMs`.
 */
export interface DurationBudget {
  readonly maxPressMs: number;
  readonly maxLandMs: number;
  readonly maxTotalMs: number;
}
export const BUDGETS: Readonly<Record<Style, DurationBudget>> = {
  clean: { maxPressMs: 100, maxLandMs: 400, maxTotalMs: 400 },
  wobbly: { maxPressMs: 100, maxLandMs: 120, maxTotalMs: 560 },
};

/** The shape of a spring: how far past the target it swings, and how soon. */
export interface Spring {
  readonly overshoot: number;
  /** Where the first peak falls, as a fraction of the duration; 0.4 (the default) is clean's single overshoot. */
  readonly peakAt?: number;
}

/**
 * The easing family: a damped spring, sampled as CSS `linear()`. Overshoot 0
 * is the critically damped curve, used as the plain ease-out; every spring in
 * lively is this function with a different overshoot and first peak. A peak
 * at 40% is one visible overshoot; an earlier peak swings faster, so the same
 * duration holds two or three swings, each smaller by the overshoot ratio.
 */
function springPosition({ overshoot, peakAt = 0.4 }: Spring): (t: number) => number {
  return (t: number): number => {
    if (overshoot <= 0) {
      // Critically damped, settling by the end.
      const omega = 7;
      return 1 - Math.exp(-omega * t) * (1 + omega * t);
    }
    const logOs = Math.log(overshoot);
    const zeta = -logOs / Math.sqrt(Math.PI ** 2 + logOs ** 2);
    const omegaD = Math.PI / peakAt;
    const omega = omegaD / Math.sqrt(1 - zeta ** 2);
    const decay = Math.exp(-zeta * omega * t);
    return 1 - decay * (Math.cos(omegaD * t) + ((zeta * omega) / omegaD) * Math.sin(omegaD * t));
  };
}

/** Enough points for the swings: 24 for one overshoot, more as the first peak comes sooner. */
function samplesFor({ peakAt = 0.4 }: Spring): number {
  return Math.max(24, Math.round(8 / peakAt));
}

export function springPoints(spring: Spring, samples = samplesFor(spring)): ReadonlyArray<number> {
  const position = springPosition(spring);
  const points: Array<number> = [];
  for (let index = 0; index <= samples; index += 1) points.push(index === samples ? 1 : position(index / samples));
  return points;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** When the spring first reaches its target, as a fraction of its duration: the "time to land". */
export function landsAt(spring: Spring, samples = 400): number {
  const position = springPosition(spring);
  for (let index = 1; index <= samples; index += 1) if (position(index / samples) >= 0.999) return index / samples;
  return 1;
}

/** A spring as a CSS `linear()` easing. */
export function springEasing(spring: Spring): string {
  return `linear(${springPoints(spring).map(round).join(", ")})`;
}

/** The same family mirrored, for exits: slow to leave, quick to go. */
export function exitEasing(): string {
  const points = springPoints({ overshoot: 0 });
  return `linear(${points.map((_, index) => round(1 - (points[points.length - 1 - index] ?? 0))).join(", ")})`;
}

/**
 * The hard stop (ZZZ's tab cut): most of the way in the first eighth, at rest
 * by `SNAP_LANDS_AT` of the duration, then dead still. Wobbly's status rings land on it.
 */
export const SNAP_LANDS_AT = 0.3;
export function snapEasing(): string {
  return `linear(0, 0.62 12%, 0.94 24%, 1 ${SNAP_LANDS_AT * 100}%, 1)`;
}

/**
 * Jelly: the extremes of the same oscillator after a squash, each the last
 * one times −overshoot, so a release wobbles as the matching spring would
 * (1, −r, r², −r³ at r = overshoot).
 */
export function jellyCoefficients(overshoot: number, swings = 4): ReadonlyArray<number> {
  return Array.from({ length: swings }, (_, k) => round((-overshoot) ** k));
}
