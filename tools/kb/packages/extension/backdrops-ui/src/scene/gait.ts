/**
 * The wing beat as a cycle, and what a gait does with it. A beat is a phase
 * that advances at the animal's own rate; the down-stroke is quicker than
 * the up-stroke; between beats a flier may glide with its wings held. All of
 * it is a continuous function of phase and glide, so the pose never jumps.
 */
import { clamp01, lerp, smoothstep, TAU } from "./math.ts";

/** The down-stroke is quicker than the recovery. */
const SKEW = 0.07;

export interface Cycle {
  /** -1 (wings fully down) … 1 (fully up). */
  readonly flap: number;
  /** How fast the wing is rising, -1 … 1. */
  readonly velocity: number;
}

/** The beat at `phase` (any real; the fraction is used). */
export function cycleAt(phase: number): Cycle {
  const a = (phase - Math.floor(phase)) * TAU;
  const theta = a + TAU * SKEW * Math.sin(a);
  const rate = (1 + TAU * SKEW * Math.cos(a)) / (1 + TAU * SKEW);
  return { flap: Math.cos(theta), velocity: -Math.sin(theta) * rate };
}

/** What a species does with a beat. */
export interface Gait {
  /** Beat angle above horizontal at the top and bottom of the stroke, radians. */
  readonly up: number;
  readonly down: number;
  /** The plane's angle while gliding, radians. */
  readonly glideBeat: number;
  /** Sweep back while beating and while gliding, radians. */
  readonly sweepBeat: number;
  readonly sweepGlide: number;
  /** The fingers' spread at the bottom and at the top of the stroke. */
  readonly spreadDown: number;
  readonly spreadUp: number;
  /** How far the tip lags the root in a stroke. */
  readonly bendGain: number;
}

export interface WingState {
  readonly beat: number;
  readonly bend: number;
  readonly sweep: number;
  readonly spread: number;
}

/**
 * The wing at `cycle` of `gait`, `glide` being how far it has settled into a
 * glide (0 beating … 1 wings held). Eased by the caller, so the move from
 * beating to gliding is continuous.
 */
export function wingState(gait: Gait, cycle: Cycle, glide: number): WingState {
  const lift = (cycle.flap + 1) / 2;
  const beating = lerp(gait.down, gait.up, lift);
  const glideAmount = smoothstep(0, 1, glide);
  return {
    beat: lerp(beating, gait.glideBeat, glideAmount),
    bend: -cycle.velocity * gait.bendGain * (1 - glideAmount),
    sweep: lerp(gait.sweepBeat, gait.sweepGlide, glideAmount),
    spread: lerp(lerp(gait.spreadDown, gait.spreadUp, lift), 1, glideAmount),
  };
}

export const BAT_GAIT: Gait = {
  up: 1.2,
  down: -0.95,
  glideBeat: 0.3,
  sweepBeat: 0.28,
  sweepGlide: 0.4,
  spreadDown: 1,
  spreadUp: 0.55,
  bendGain: 0.55,
};

export const SWALLOW_GAIT: Gait = {
  up: 0.95,
  down: -0.8,
  glideBeat: 0.12,
  sweepBeat: 0.55,
  sweepGlide: 1.1,
  spreadDown: 1,
  spreadUp: 0.85,
  bendGain: 0.5,
};

/** `from` toward `to`: the pose of a wing between two states, for a bat that is letting go or taking hold. */
export function blendWing(from: WingState, to: WingState, t: number): WingState {
  return {
    beat: lerp(from.beat, to.beat, t),
    bend: lerp(from.bend, to.bend, t),
    sweep: lerp(from.sweep, to.sweep, t),
    spread: lerp(from.spread, to.spread, t),
  };
}

/**
 * A bat at rest, hanging: the wings brought down and round the body like a
 * cloak (`wrap` 1) or let out a little (`wrap` 0); `stretch` unfolds one
 * wing's worth of arm for a stretch. It is a pose of the flying figure, so
 * letting go and taking hold are the same wing at every point between.
 */
export function hangState(wrap: number, stretch: number): WingState {
  const tight = clamp01(wrap);
  return {
    beat: lerp(-1.2, -1.7, tight) + stretch * 2.6,
    bend: 0,
    sweep: lerp(-0.8, -1.35, tight) + stretch * 1.7,
    spread: lerp(0.65, 0.3, tight) + stretch * 0.7,
  };
}
