/**
 * Drag-to-turn with momentum (Lab principles M1, M3): a drag follows the
 * pointer exactly, and on release the view coasts on the drag's smoothed
 * speed and decays to rest. Plain arithmetic on one mutable record, so a
 * frame allocates nothing (P3); shared by every study that pans.
 */

/** Where the view points, and how fast it is still turning (rad, rad/s). */
export interface Pan {
  yaw: number;
  pitch: number;
  yawSpeed: number;
  pitchSpeed: number;
}

export interface PanLimits {
  /** Radians of turn per CSS pixel dragged. */
  readonly perPixel: number;
  readonly pitchLimit: number;
  /** Yaw is unbounded when absent. */
  readonly yawLimit?: number;
}

export const SKY_PAN: PanLimits = { perPixel: 0.0032, pitchLimit: 0.7 };

export function restingPan(): Pan {
  return { yaw: 0, pitch: 0, yawSpeed: 0, pitchSpeed: 0 };
}

/** How quickly a released pan coasts to a stop (1/s): about 1.5s to rest. */
const FRICTION = 2.6;
/** The fastest a flick may leave the view turning (rad/s). */
const MAX_SPEED = 1.6;
/** How much of each move's speed replaces the running estimate. */
const SPEED_BLEND = 0.3;

function clamp(value: number, limit: number | undefined): number {
  return limit === undefined ? value : Math.max(-limit, Math.min(limit, value));
}

function flick(previous: number, moved: number, step: number): number {
  return clamp(previous + (moved / step - previous) * SPEED_BLEND, MAX_SPEED);
}

/**
 * A drag moved `dx, dy` pixels over `dt` seconds: follow it, and keep a
 * smoothed, capped estimate of its speed, so one fast pointer event cannot
 * fling the view round.
 */
export function panDrag(pan: Pan, limits: PanLimits, dx: number, dy: number, dt: number): void {
  const step = Math.max(dt, 1 / 120);
  const yaw = clamp(pan.yaw - dx * limits.perPixel, limits.yawLimit);
  const pitch = clamp(pan.pitch + dy * limits.perPixel, limits.pitchLimit);
  pan.yawSpeed = flick(pan.yawSpeed, yaw - pan.yaw, step);
  pan.pitchSpeed = flick(pan.pitchSpeed, pitch - pan.pitch, step);
  pan.yaw = yaw;
  pan.pitch = pitch;
}

/** A release long after the last move is a stop, not a flick. */
export function panRelease(pan: Pan, sinceLastMove: number): void {
  if (sinceLastMove > 0.09) {
    pan.yawSpeed = 0;
    pan.pitchSpeed = 0;
  }
}

/**
 * One frame of coasting after release. Under reduced motion (M7) a released
 * pan stops where it was let go: the drag moved it, nothing else will.
 */
export function panCoast(pan: Pan, limits: PanLimits, dt: number, reducedMotion: boolean): void {
  if (reducedMotion) {
    pan.yawSpeed = 0;
    pan.pitchSpeed = 0;
    return;
  }
  const decay = Math.exp(-FRICTION * dt);
  const yaw = clamp(pan.yaw + pan.yawSpeed * dt, limits.yawLimit);
  const pitch = clamp(pan.pitch + pan.pitchSpeed * dt, limits.pitchLimit);
  pan.yawSpeed = yaw === pan.yaw ? 0 : pan.yawSpeed * decay;
  pan.pitchSpeed = pitch === pan.pitch ? 0 : pan.pitchSpeed * decay;
  pan.yaw = yaw;
  pan.pitch = pitch;
}
