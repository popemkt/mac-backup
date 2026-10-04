/**
 * Embers' pop budget (Lab principle M4: one hero motion at a time). Plain
 * arithmetic, run on the CPU once a frame; the GPU asks, this answers.
 */

/**
 * The pop budget, on the CPU: pops refill at `rate` a second up to `bank`,
 * and two are never closer than `gap` seconds. A grant nobody uses is spent
 * anyway — the budget caps pops, it does not promise them.
 */
export class PopGrants {
  private banked = 1;
  private since = Infinity;
  private readonly rate: number;
  private readonly bank: number;
  private readonly gap: number;

  constructor(rate = 0.8, bank = 2, gap = 0.35) {
    this.rate = rate;
    this.bank = bank;
    this.gap = gap;
  }

  /** How many pops this frame may start: 0 or 1. */
  next(dt: number): number {
    this.banked = Math.min(this.bank, this.banked + this.rate * dt);
    this.since += dt;
    if (this.banked < 1 || this.since < this.gap) return 0;
    this.banked -= 1;
    this.since = 0;
    return 1;
  }
}
