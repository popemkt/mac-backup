/**
 * A study's entrance (Lab principles P2, M3, M6, M7): once the stage has
 * faded the canvas in, the study's pieces arrive — a cloud grows from its
 * core, stars kindle by depth, a sea rises from calm — over the arrive
 * duration, on the one ease, each piece a little behind the one before.
 *
 * The clock is here once; what arrives, and in which order, is the study's
 * (`arrival`, given each piece's lag). Under reduced motion the entrance is
 * already over: the first still is the whole composition.
 */
import { uniform } from "three/tsl";
import { easeNode, type TslNode } from "@/scene/gpu/tsl";
import type { Timing } from "@/lib/timing";

/** How much of the entrance the stagger spans; the rest is each piece's own arrival. */
const SPREAD = 0.55;

export class Entrance {
  /** 0 → 1 over the arrive duration, linear; `arrival` shapes it. */
  readonly progress = uniform(0);
  private elapsed = 0;
  private readonly duration: number;
  private readonly ease: (t: TslNode) => TslNode;

  constructor(timing: Timing) {
    this.duration = timing.arrive;
    this.ease = easeNode(timing.settle);
  }

  step(dt: number, reduced: boolean): void {
    if (reduced) {
      this.progress.value = 1;
      return;
    }
    this.elapsed += dt;
    this.progress.value = Math.min(1, this.elapsed / this.duration);
  }

  /**
   * How far a piece has arrived, 0 → 1 on the settle ease, for a piece whose
   * place in the order is `lag` (0 first, 1 last).
   */
  arrival(lag: TslNode): TslNode {
    return this.ease(
      this.progress
        .sub(lag.clamp(0, 1).mul(SPREAD))
        .div(1 - SPREAD)
        .clamp(0, 1),
    );
  }
}
