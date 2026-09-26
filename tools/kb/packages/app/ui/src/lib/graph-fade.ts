/**
 * Eased emphasis: the one way a graph renderer moves an item's emphasis —
 * its dim, its glow — from one state to the next (Lab principles M1, M5, M7).
 *
 * `graph-dim` and `graph-interaction` say what an item's emphasis *is* for a
 * hover, a selection, a search or a filter; this says how it gets there. Each
 * item's value approaches its target frame-rate-independently at the rate
 * that closes the gap in `--motion-duration-quick`, so a hover fades in on the
 * next frame and has settled in about 220ms, and leaving fades back out the
 * same way. Under reduced motion every value jumps (a still composition).
 *
 * Values live in one Float32Array, indexed by the renderer's own item order,
 * so a frame's step allocates nothing (P3).
 */
import { approachRate, approachShare } from "@/lib/timing";

/** Below this gap a value has arrived, and is set exactly. */
const ARRIVED = 1e-3;

export class EmphasisFade {
  values: Float32Array;
  private targets: Float32Array;
  private moving = false;
  private readonly rate: number;

  /** `seconds`: how long a change takes to settle (a motion token). */
  constructor(count: number, seconds: number, initial = 1) {
    this.values = new Float32Array(count).fill(initial);
    this.targets = new Float32Array(count).fill(initial);
    this.rate = approachRate(seconds);
  }

  get count(): number {
    return this.values.length;
  }

  /** Whether a step would still change anything. */
  get active(): boolean {
    return this.moving;
  }

  /**
   * Start over for a new item set. Items keep nothing across it: a new graph
   * arrives at its targets, it does not fade in from the old one's values.
   */
  reset(count: number, initial = 1): void {
    this.values = new Float32Array(count).fill(initial);
    this.targets = new Float32Array(count).fill(initial);
    this.moving = false;
  }

  target(index: number): number {
    return this.targets[index] ?? 0;
  }

  setTarget(index: number, value: number): void {
    if (index < 0 || index >= this.targets.length || this.targets[index] === value) return;
    this.targets[index] = value;
    this.moving = true;
  }

  /** Every value at its target now. */
  snap(): void {
    this.values.set(this.targets);
    this.moving = false;
  }

  /**
   * Advance every value by `dt` seconds; `reduced` jumps them. Returns
   * whether anything changed, so a renderer draws only when it must.
   */
  step(dt: number, reduced: boolean): boolean {
    if (!this.moving) return false;
    if (reduced) {
      this.snap();
      return true;
    }
    const share = approachShare(this.rate, dt);
    let still = true;
    for (let i = 0; i < this.values.length; i++) {
      const target = this.targets[i] ?? 0;
      const gap = (this.values[i] ?? 0) - target;
      if (gap === 0) continue;
      const next = gap * (1 - share);
      if (Math.abs(next) < ARRIVED) this.values[i] = target;
      else {
        this.values[i] = target + next;
        still = false;
      }
    }
    this.moving = !still;
    return true;
  }
}
