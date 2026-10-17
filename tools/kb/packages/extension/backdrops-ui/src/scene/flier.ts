/**
 * A flier: one bat or swallow in the air, with its own size, pace, beat and
 * temperament. Individuality is what keeps a flock from reading as a loop:
 * each flier steers by its own slowly drifting noise, beats at its own rate,
 * and takes its own time between a beat and a glide.
 */
import { seededNoise, type Rng } from "./rng.ts";

export type Species = "bat" | "swallow";

export interface Flier {
  readonly id: number;
  species: Species;
  /** 0 nearest the viewer … 1 farthest: smaller, slower, veiled. */
  depth: number;
  /** Body length, CSS pixels. */
  size: number;
  /** Cruising speed, pixels per second. */
  cruise: number;
  /** Wing beats per second. */
  beatHz: number;
  phase: number;
  /** How far settled into a glide: 0 beating … 1 wings held. */
  glide: number;
  glideGoal: number;
  /** Seconds until the next change between beating and gliding. */
  modeLeft: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Where it means to go, radians: it turns by its own noise, so wandering has a memory. */
  heading: number;
  /** -1 … 1: which way it faces, eased through 0 as it turns to the viewer. */
  turn: number;
  tilt: number;
  /** +1 or -1: which way it circles the light. */
  swirl: number;
  /** Seconds this flier stays in the scene before it leaves and a new one enters. */
  life: number;
  leaving: boolean;
  /** 0 eyes open … 1 shut. */
  blink: number;
  blinkLeft: number;
  /** A steering whim: what the flier is doing besides drifting. */
  task: Task;
  noise: (t: number) => number;
  noiseB: (t: number) => number;
  /** A per-flier clock offset into its noise. */
  clock: number;
}

/** What a flier does besides drift. A moment (`moments.ts`) sets it; it ends on its own. */
export type Task =
  | { readonly kind: "free" }
  | { readonly kind: "chase"; readonly target: number; readonly until: number }
  | { readonly kind: "evade"; readonly until: number }
  | { readonly kind: "join"; readonly until: number }
  /** Head for a place and slow to arrive at it: a bat returning to its perch. */
  | { readonly kind: "perch"; readonly x: number; readonly y: number; readonly until: number }
  /** Cross the frame in a line, past the edges, ignoring the walls: a swallow darting by. */
  | { readonly kind: "cross"; readonly dir: 1 | -1; readonly until: number };

export const FREE: Task = { kind: "free" };

/** Depth changes what the eye sees of a flier: its size, pace and veil. */
export function depthScale(depth: number): { size: number; speed: number; veil: number } {
  return { size: 1 - 0.5 * depth, speed: 1 - 0.45 * depth, veil: 1 - 0.5 * depth };
}

const BAT_SIZE: readonly [number, number] = [34, 52];
const SWALLOW_SIZE: readonly [number, number] = [26, 38];

/** A new flier of `species` at `depth`, with a personality of its own. */
export function newFlier(
  rng: Rng,
  id: number,
  species: Species,
  depth: number,
  at: { x: number; y: number },
): Flier {
  const scale = depthScale(depth);
  const [low, high] = species === "bat" ? BAT_SIZE : SWALLOW_SIZE;
  const seed = Math.floor(rng.next() * 1e9);
  const cruise = (species === "bat" ? rng.range(46, 78) : rng.range(70, 110)) * scale.speed;
  const heading = rng.range(0, Math.PI * 2);
  return {
    id,
    species,
    depth,
    size: rng.range(low, high) * scale.size,
    cruise,
    beatHz: (species === "bat" ? rng.range(3.0, 4.4) : rng.range(3.6, 5.2)) * (1 - 0.25 * depth),
    phase: rng.next(),
    glide: 0,
    glideGoal: 0,
    modeLeft: rng.range(0.4, 2.4),
    x: at.x,
    y: at.y,
    vx: Math.cos(heading) * cruise,
    vy: Math.sin(heading) * cruise * 0.4,
    heading,
    turn: Math.cos(heading) >= 0 ? 1 : -1,
    tilt: 0,
    swirl: rng.chance(0.5) ? 1 : -1,
    life: rng.range(45, 130),
    leaving: false,
    blink: 0,
    blinkLeft: rng.range(1.5, 6),
    task: FREE,
    noise: seededNoise(seed),
    noiseB: seededNoise(seed ^ 0x9e3779b9),
    clock: rng.range(0, 500),
  };
}
