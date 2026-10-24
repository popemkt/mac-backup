// The motion system: one set of tokens per (style, intensity), and one easing
// family. Every effect reads these tokens (as CSS custom properties); no
// effect has a number of its own. Raising the intensity scales distance,
// scale, overshoot, duration, blur, glow and stagger together, so subtle and
// bold are the same system at two volumes.
//
// The style is a second, orthogonal axis: the character of the motion rather
// than its volume. Only `clean` exists today (one overshoot, then rest); a
// style that bounces more adds its own row of intensities to MOTION_TOKENS
// and a `bounces` above 1, and nothing else here changes.
import { Schema } from "effect";

export const INTENSITIES = ["subtle", "lively", "bold"] as const;
export const Intensity = Schema.Literals(INTENSITIES);
export type Intensity = typeof Intensity.Type;

export const STYLES = ["clean"] as const;
export const Style = Schema.Literals(STYLES);
export type Style = typeof Style.Type;
/** The style in force until there is a setting to choose another. */
export const DEFAULT_STYLE: Style = "clean";

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
  /** Spring overshoot past the target, as a fraction (0.16 = 16%). */
  readonly overshoot: number;
  /** How many times the spring swings past its target before it rests (clean: 1). */
  readonly bounces: number;
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
}

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
    bounces: 1,
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
    bounces: 1,
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
    bounces: 1,
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
  },
};

/** Every token, by style and then intensity. */
export const MOTION_TOKENS: Readonly<Record<Style, Readonly<Record<Intensity, MotionTokens>>>> = { clean: CLEAN };

/** The tokens for one (style, intensity), before speed. */
export function motionTokens(style: Style, intensity: Intensity): MotionTokens {
  return MOTION_TOKENS[style][intensity];
}

/**
 * Budget: presses stay snappy; nothing that runs once lasts longer than an
 * entrance may. For `clean` the spring lands at its peak and settles at once,
 * so one cap on the total is enough; a style with more bounces should cap the
 * time to land (`landsAt`) and the total separately.
 */
export const MAX_PRESS_MS = 100;
export const MAX_ONCE_MS = 400;

/** The shape of a spring: how far past the target it swings, and how many times. */
export interface Spring {
  readonly overshoot: number;
  /** Swings past the target before rest; 1 (the default) is clean's single overshoot. */
  readonly bounces?: number;
}

/**
 * The easing family: a damped spring, sampled as CSS `linear()`. Overshoot 0
 * is the critically damped curve, used as the plain ease-out; every spring in
 * lively is this function with a different overshoot. With one bounce it
 * peaks at 40% of its duration; more bounces swing faster (the first peak at
 * 40% / bounces), each peak smaller by the overshoot ratio.
 */
function springPosition({ overshoot, bounces = 1 }: Spring): (t: number) => number {
  const peakAt = 0.4 / Math.max(1, bounces);
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

export function springPoints(spring: Spring, samples = 24): ReadonlyArray<number> {
  const position = springPosition(spring);
  const points: Array<number> = [];
  for (let index = 0; index <= samples; index += 1) points.push(index === samples ? 1 : position(index / samples));
  return points;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * When the spring first reaches its target, as a fraction of its duration:
 * the "time to land" a bouncier style budgets separately from the total.
 */
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
