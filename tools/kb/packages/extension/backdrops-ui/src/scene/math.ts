/** The small numeric vocabulary every scene part shares. All motion is a function of elapsed seconds. */

export const TAU = Math.PI * 2;

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** 0 below `low`, 1 above `high`, an S-curve between. */
export function smoothstep(low: number, high: number, value: number): number {
  const t = clamp01((value - low) / (high - low));
  return t * t * (3 - 2 * t);
}

/**
 * Move `current` toward `target` the way a damped spring settles, at `rate`
 * (per second). Frame-rate independent: the same elapsed time lands in the
 * same place at 60 or 120 Hz, so easing never depends on the display.
 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

/** `angle` folded into (-π, π]. */
export function wrapAngle(angle: number): number {
  let wrapped = angle % TAU;
  if (wrapped > Math.PI) wrapped -= TAU;
  else if (wrapped <= -Math.PI) wrapped += TAU;
  return wrapped;
}

/** The signed shortest turn from `from` to `to`. */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** `damp`, along the shortest way round a circle. */
export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  return wrapAngle(current + angleDelta(current, target) * (1 - Math.exp(-rate * dt)));
}

/** A pulse that rises over `rise` seconds and falls over `fall`, from the time `t` since it was fired. */
export function envelope(t: number, rise: number, fall: number): number {
  if (t < 0) return 0;
  if (t < rise) return smoothstep(0, rise, t);
  return Math.exp(-(t - rise) / fall);
}
