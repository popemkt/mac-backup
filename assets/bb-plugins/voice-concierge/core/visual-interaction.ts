import { VISUALS, type VisualStyle } from "./visuals.ts";
import { advanceSpring, type SpringState } from "./spring.ts";

export interface VisualGesture {
  x: number; y: number; vx: number; vy: number;
  align: number; tap: number; press: number; intro: number;
  tapX: number; tapY: number;
}
const resting = (value = 0): SpringState => ({ value, velocity: 0 });
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** One physical gesture model, independent of call state and renderer materials. */
export class VisualInteraction {
  private style: VisualStyle;
  private target = { x: 0, y: 0 };
  private pointer = { x: resting(), y: resting() };
  private alignment = resting();
  private impulse = resting();
  private pressure = resting();
  private entrance = resting();
  private held = false;
  private aligned = false;
  private releaseAt = Infinity;
  private contact: { x: number; y: number } | null = null;
  private tapPoint = { x: 0, y: 0 };

  constructor(style: VisualStyle, now: number, reduced = false) {
    this.style = style;
    this.reset(style, now, reduced);
  }

  reset(style: VisualStyle, now: number, reduced = false): void {
    this.style = style;
    this.target = { x: 0, y: 0 };
    this.pointer = { x: resting(), y: resting() };
    this.aligned = VISUALS[style].interaction === "align" && !reduced;
    this.alignment = resting(this.aligned ? 1 : 0);
    this.impulse = resting();
    this.pressure = resting();
    this.entrance = resting(reduced || VISUALS[style].interaction === "call" ? 1 : 0);
    this.held = false;
    this.contact = null;
    this.tapPoint = { x: 0, y: 0 };
    this.releaseAt = this.aligned ? now + 1100 : Infinity;
  }

  point(x: number, y: number): void {
    const bounded = (n: number) => Number.isFinite(n) ? clamp(n, -1, 1) : 0;
    this.target = { x: bounded(x), y: bounded(y) };
    if (this.held) { this.contact = { ...this.target }; this.tapPoint = { ...this.target }; }
  }

  press(held: boolean): void {
    this.held = held;
    if (held) { this.contact = { ...this.target }; this.tapPoint = { ...this.target }; }
  }

  /** Taps inject energy into the existing motion instead of restarting an animation. */
  activate(now: number, holdSeconds = 2.5): boolean {
    const interaction = VISUALS[this.style].interaction;
    if (interaction === "call") return false;
    this.tapPoint = { ...(this.contact ?? this.target) };
    this.contact = null;
    this.impulse.value = clamp(this.impulse.value + (interaction === "align" ? 0.18 : 0.6), -1.2, 1.25);
    this.impulse.velocity = clamp(this.impulse.velocity + 5, -20, 20);
    if (interaction === "align") {
      this.aligned = !this.aligned;
      this.releaseAt = this.aligned && holdSeconds > 0 ? now + holdSeconds * 1000 : Infinity;
    }
    return true;
  }

  get isAligned(): boolean { return this.aligned; }
  get wakeAt(): number { return this.releaseAt; }

  tick(dt: number, now: number, reduced = false): VisualGesture {
    if (now >= this.releaseAt) { this.aligned = false; this.releaseAt = Infinity; }
    if (reduced) {
      this.pointer = { x: resting(), y: resting() };
      this.alignment = resting(this.aligned ? 1 : 0);
      this.impulse = resting();
      this.pressure = resting();
      this.entrance = resting(1);
    } else {
      advanceSpring(this.pointer.x, this.target.x, dt, 2.8, 0.64);
      advanceSpring(this.pointer.y, this.target.y, dt, 2.8, 0.64);
      advanceSpring(this.alignment, this.aligned ? 1 : 0, dt, 1.8, 0.66);
      advanceSpring(this.impulse, 0, dt, 3.2, 0.34);
      advanceSpring(this.pressure, this.held ? 1 : 0, dt, 3.0, 0.6);
      advanceSpring(this.entrance, 1, dt, 2.2, 0.62);
    }
    return {
      x: clamp(this.pointer.x.value, -1.12, 1.12), y: clamp(this.pointer.y.value, -1.12, 1.12),
      vx: clamp(this.pointer.x.velocity, -3, 3), vy: clamp(this.pointer.y.velocity, -3, 3),
      align: clamp(this.alignment.value, -0.08, 1.08),
      tap: clamp(this.impulse.value, -1.2, 1.25),
      press: clamp(this.pressure.value, -0.15, 1.1),
      intro: clamp(this.entrance.value, 0, 1.1),
      tapX: this.tapPoint.x, tapY: this.tapPoint.y,
    };
  }
}
