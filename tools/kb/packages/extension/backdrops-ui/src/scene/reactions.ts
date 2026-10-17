/**
 * How a scene feels the owner (DESIGN-UI.md → Page-head backdrops): the
 * pointer over its frame, typing, a write landing, a move to another page.
 * Each becomes one eased signal a composition reads, so no reaction snaps
 * on or off.
 *
 * - `calm` rises while a node's text is being edited and falls when the
 *   owner stops: actors settle, slow and ignore the pointer.
 * - `stir` and `ripple` are pulses: a write is a small `stir` (none while
 *   calm, since typing writes), a move to another page a `ripple`, both
 *   decaying by themselves.
 * - `pointer` is where the owner's pointer is over the frame (null when it
 *   is not), its `near` easing in and out so the actors do not twitch at the
 *   edge, and `speed` how fast it is moving.
 */
import { clamp01, damp, envelope } from "./math.ts";

interface PointerState {
  readonly x: number;
  readonly y: number;
  /** 0 when absent, easing to 1 while over the frame. */
  readonly near: number;
  /** Pixels per second, smoothed. */
  readonly speed: number;
}

/** A pulse fired at a time, and read as the time since. */
interface Pulse {
  at: number;
  rise: number;
  fall: number;
  gain: number;
}

export interface Reactions {
  readonly calm: number;
  /** A write landed: 0..1, quick up and slow down. */
  readonly stir: number;
  /** The owner moved to another page: 0..1, slower. */
  readonly ripple: number;
  readonly pointer: PointerState;
  /** Fired by the stage when the activity signal moves. */
  readonly write: () => void;
  readonly navigate: () => void;
  readonly setEditing: (editing: boolean) => void;
  readonly setPointer: (x: number, y: number) => void;
  readonly clearPointer: () => void;
  /** Advance by `dt` seconds. */
  readonly update: (dt: number) => void;
  /** The `ripple` age: seconds since the last navigation (Infinity before any). */
  readonly sinceNavigate: () => number;
}

const pulseValue = (pulse: Pulse, now: number): number =>
  clamp01(pulse.gain * envelope(now - pulse.at, pulse.rise, pulse.fall));

export function startReactions(): Reactions {
  let now = 0;
  let calm = 0;
  let editing = false;
  const stirPulse: Pulse = { at: -1e9, rise: 0.18, fall: 1.1, gain: 1 };
  const ripplePulse: Pulse = { at: -1e9, rise: 0.35, fall: 2.4, gain: 1 };
  let px = 0;
  let py = 0;
  let over = false;
  let near = 0;
  let speed = 0;
  let lastX = 0;
  let lastY = 0;
  let sinceMove = 0;

  const reactions: Reactions = {
    get calm() {
      return calm;
    },
    get stir() {
      // A write while the owner is typing does not stir: typing keeps the scene calm.
      return pulseValue(stirPulse, now) * (1 - calm);
    },
    get ripple() {
      return pulseValue(ripplePulse, now);
    },
    get pointer() {
      return { x: px, y: py, near, speed };
    },
    write: () => {
      stirPulse.at = now;
    },
    navigate: () => {
      ripplePulse.at = now;
    },
    setEditing: (value) => {
      editing = value;
    },
    setPointer: (x, y) => {
      if (!over) {
        lastX = x;
        lastY = y;
      }
      px = x;
      py = y;
      over = true;
    },
    clearPointer: () => {
      over = false;
    },
    update: (dt) => {
      now += dt;
      calm = damp(calm, editing ? 1 : 0, editing ? 1.4 : 0.55, dt);
      near = damp(near, over ? 1 : 0, over ? 6 : 2.5, dt);
      const moved = Math.hypot(px - lastX, py - lastY);
      lastX = px;
      lastY = py;
      sinceMove = moved > 0 ? 0 : sinceMove + dt;
      const instant = dt > 0 ? moved / dt : 0;
      speed = damp(speed, sinceMove > 0.1 ? 0 : instant, 8, dt);
    },
    sinceNavigate: () => now - ripplePulse.at,
  };
  return reactions;
}
