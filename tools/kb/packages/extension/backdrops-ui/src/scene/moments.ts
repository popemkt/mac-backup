/**
 * Rare moments: the things that reward a second look. They are scheduled
 * with exponentially distributed waits, so the next is never predictable and
 * a lull is as likely as two close together; and never twice within
 * `cooldown`, so they stay rare however the dice fall.
 */
import type { Rng } from "./rng.ts";

export interface Moments {
  /** The time of the next moment, seconds on the scene's clock. */
  readonly next: () => number;
  /** Whether a moment is due at `time`; if so, the next is scheduled and this returns true once. */
  readonly due: (time: number) => boolean;
}

export function rareMoments(rng: Rng, mean: number, cooldown: number, first: number): Moments {
  let at = first;
  const wait = () => cooldown - mean * Math.log(1 - rng.next() * 0.999);
  return {
    next: () => at,
    due: (time) => {
      if (time < at) return false;
      at = time + wait();
      return true;
    },
  };
}
