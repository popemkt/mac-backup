/**
 * How Embers is steered, one frame at a time: plain arithmetic, no three,
 * so the frame's contract is testable on its own.
 *
 * The cloud's centre follows its aim on critically damped springs that settle
 * in the follow duration (M1, M5). The aim is the pointer on the cloud's
 * plane, or, while the pointer is idle or away, a slow figure of eight over
 * the ambient period (M4) — which is not the pointer, so it shoves nothing.
 * The pointer's velocity is `PointerVelocity`'s, and a zero step (a loop
 * restart) steps nothing and forgets it.
 */
import { springRate, stepSpring, type Spring, type Timing } from "@/lib/timing";
import { PointerVelocity } from "@/components/lab/kit/velocity";

/** Where the pointer is parked while it shoves nothing: far behind the cloud. */
const POINTER_AWAY = 100;

export class EmberSteer {
  /** The cloud's centre, and the pointer (x, y, z) with its velocity. */
  readonly center = { x: 0, y: 0 };
  readonly pointer = { x: 0, y: 0, z: POINTER_AWAY };
  readonly velocity: PointerVelocity = new PointerVelocity();
  private readonly cx: Spring = { x: 0, v: 0 };
  private readonly cy: Spring = { x: 0, v: 0 };
  private readonly drift = { x: 0, y: 0 };
  private readonly follow: number;
  private readonly ambient: number;

  constructor(timing: Timing) {
    this.follow = springRate(timing.follow);
    this.ambient = (Math.PI * 2) / timing.ambientPeriod;
  }

  /**
   * One frame. `aim` is the live pointer on the cloud's plane, or `null`
   * while it is idle or away. Returns whether the simulation should step.
   */
  frame(
    dt: number,
    elapsed: number,
    aim: { readonly x: number; readonly y: number } | null,
  ): boolean {
    this.velocity.step(dt, aim);
    if (dt <= 0) return false;
    const w = this.ambient;
    this.drift.x = Math.sin(elapsed * w) * 0.8;
    this.drift.y = Math.sin(elapsed * w * 2) * 0.35;
    const target = aim ?? this.drift;
    stepSpring(this.cx, target.x, this.follow, dt);
    stepSpring(this.cy, target.y, this.follow, dt);
    this.center.x = this.cx.x;
    this.center.y = this.cy.x;
    this.pointer.x = aim?.x ?? 0;
    this.pointer.y = aim?.y ?? 0;
    this.pointer.z = aim === null ? POINTER_AWAY : 0;
    return true;
  }
}
