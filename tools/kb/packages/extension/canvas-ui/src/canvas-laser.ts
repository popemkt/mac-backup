/**
 * Present mode's laser (DESIGN-UI.md → Canvas → Present mode): the pointer
 * leaves a trail that fades as it ages, so a presenter can point at what
 * they talk about. It is a look on the screen, in viewport pixels, in
 * either projection, and nothing of it is written anywhere.
 */

/** How long a point of the trail stays, fading, before it is gone: milliseconds. */
export const LASER_TRAIL_MS = 600;

/** A point the pointer passed, in viewport pixels, and when: milliseconds. */
export interface LaserPoint {
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

/** One stroke of the trail, from one point to the next, as visible as it is young. */
export interface LaserSegment {
  readonly from: LaserPoint;
  readonly to: LaserPoint;
  /** 1 for a stroke drawn now, falling to 0 as it reaches the trail's age. */
  readonly opacity: number;
}

/** The points of `points` still on the trail at `now`. */
export function liveLaserPoints(points: readonly LaserPoint[], now: number): LaserPoint[] {
  return points.filter((point) => now - point.t < LASER_TRAIL_MS);
}

/** The trail at `now`: a stroke between each two live points, faded by the newer one's age. */
export function laserSegments(points: readonly LaserPoint[], now: number): LaserSegment[] {
  const live = liveLaserPoints(points, now);
  return live.slice(1).map((to, i) => ({
    from: live[i] ?? to,
    to,
    opacity: Math.max(0, 1 - (now - to.t) / LASER_TRAIL_MS),
  }));
}
