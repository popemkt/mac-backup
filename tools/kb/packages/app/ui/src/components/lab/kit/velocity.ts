/**
 * A pointer's smoothed velocity in world units (Lab principles M1, M5).
 *
 * Velocity is sampled only between two live frames. A frame after an idle
 * spell (or the very first) seeds the last position instead of differencing
 * against it, so returning to the view is never read as a flick; while idle
 * the estimate eases back to rest. A zero step is a break in time — the loop
 * stopped (a hidden tab, reduced motion) and is starting again — so it drops
 * the estimate and the seed outright: nothing measured before the break may
 * be carried across it.
 */

/** How quickly the estimate follows the sampled speed (1/s). */
const BLEND_RATE = 14;

export class PointerVelocity {
  x = 0;
  y = 0;
  private lastX = 0;
  private lastY = 0;
  private seeded = false;

  /** One frame: the pointer at (x, y), or `null` while it is idle or away. */
  step(dt: number, at: { readonly x: number; readonly y: number } | null): void {
    if (dt <= 0) {
      this.seeded = false;
      this.x = 0;
      this.y = 0;
      return;
    }
    const blend = 1 - Math.exp(-dt * BLEND_RATE);
    if (at === null) {
      this.seeded = false;
      this.x -= this.x * blend;
      this.y -= this.y * blend;
      return;
    }
    if (this.seeded) {
      this.x += ((at.x - this.lastX) / dt - this.x) * blend;
      this.y += ((at.y - this.lastY) / dt - this.y) * blend;
    }
    this.lastX = at.x;
    this.lastY = at.y;
    this.seeded = true;
  }
}
