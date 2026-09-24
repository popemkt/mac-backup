/**
 * The motion study's field: a grid of tiles, each lifting toward a target
 * set by the pointer, in one of two drives.
 *
 * - `spring`: a critically damped spring that settles in the chosen time.
 *   Retargeting mid-flight keeps the velocity it has, so a moving pointer
 *   gives a continuous, unbroken motion (M1).
 * - `ease`: the `--motion-settle` curve over the same time, restarted from
 *   wherever the tile is whenever its target moves. Every restart drops the
 *   velocity to the ease's start, which is the visible hitch this study
 *   exists to show.
 *
 * Stagger (M3): a tile sees the pointer as it was `distance × stagger` ago,
 * read from a short history, so a gesture spreads outward as a wave with one
 * consistent delay per unit distance. Overlap (M3): a tile's glow follows its
 * own lift on a slower spring, so the colour trails the motion.
 *
 * Plain arithmetic over typed arrays; a step allocates nothing (P3).
 */
import { easeAt, springRate, stepSpring, type CubicBezier, type Spring } from "@/lib/timing";

export type Drive = "spring" | "ease";

/** Pointer history: enough to look back over the widest stagger. */
const HISTORY = 128;

export class TileField {
  readonly side: number;
  readonly count: number;
  /** Tile centres on the floor, xz per tile, in world units. */
  readonly centers: Float32Array;
  /** 0…1 per tile: how far it has lifted, and how far its glow has followed. */
  readonly lift: Float32Array;
  readonly glow: Float32Array;
  drive: Drive = "spring";
  /** Seconds. */
  settle: number;
  stagger: number;
  overlap = true;
  private readonly springs: Spring[];
  private readonly glowSprings: Spring[];
  private readonly from: Float32Array;
  private readonly to: Float32Array;
  private readonly since: Float32Array;
  private readonly history = new Float32Array(HISTORY * 3);
  private head = 0;
  private time = 0;
  private readonly curve: CubicBezier;
  private readonly spacing: number;

  constructor(side: number, spacing: number, settle: number, stagger: number, curve: CubicBezier) {
    this.side = side;
    this.spacing = spacing;
    this.count = side * side;
    this.centers = new Float32Array(this.count * 2);
    const offset = ((side - 1) * spacing) / 2;
    for (let i = 0; i < this.count; i++) {
      this.centers[i * 2] = (i % side) * spacing - offset;
      this.centers[i * 2 + 1] = Math.floor(i / side) * spacing - offset;
    }
    this.lift = new Float32Array(this.count);
    this.glow = new Float32Array(this.count);
    this.springs = Array.from({ length: this.count }, () => ({ x: 0, v: 0 }));
    this.glowSprings = Array.from({ length: this.count }, () => ({ x: 0, v: 0 }));
    this.from = new Float32Array(this.count);
    this.to = new Float32Array(this.count);
    this.since = new Float32Array(this.count).fill(Infinity);
    this.settle = settle;
    this.stagger = stagger;
    this.curve = curve;
    this.history.fill(1e6);
  }

  /** Where the pointer was `ago` seconds back (x, z), or far away. */
  private pointerAt(ago: number, out: { x: number; z: number }): void {
    const want = this.time - ago;
    for (let k = 0; k < HISTORY; k++) {
      const slot = (this.head - 1 - k + HISTORY * 2) % HISTORY;
      if ((this.history[slot * 3 + 2] ?? 0) <= want) {
        out.x = this.history[slot * 3] ?? 1e6;
        out.z = this.history[slot * 3 + 1] ?? 1e6;
        return;
      }
    }
    out.x = 1e6;
    out.z = 1e6;
  }

  private readonly seen = { x: 0, z: 0 };

  /** Advance by `dt` with the pointer at (x, z) on the floor; far away when absent. */
  step(dt: number, x: number, z: number, radius: number): void {
    if (dt <= 0) return;
    this.time += dt;
    this.history[this.head * 3] = x;
    this.history[this.head * 3 + 1] = z;
    this.history[this.head * 3 + 2] = this.time;
    this.head = (this.head + 1) % HISTORY;
    const rate = springRate(this.settle);
    const glowRate = springRate(this.settle * (this.overlap ? 2.2 : 1));
    for (let i = 0; i < this.count; i++) {
      const cx = this.centers[i * 2] ?? 0;
      const cz = this.centers[i * 2 + 1] ?? 0;
      const reach = Math.hypot(cx - x, cz - z);
      // One stagger step per neighbour away (M3: small and consistent).
      this.pointerAt((Math.min(reach, 12) / this.spacing) * this.stagger, this.seen);
      const d = Math.hypot(cx - this.seen.x, cz - this.seen.z) / radius;
      const target = Math.exp(-d * d);
      this.lift[i] = this.advance(i, target, rate, dt);
      const g = this.glowSprings[i];
      if (g !== undefined) {
        stepSpring(g, this.lift[i] ?? 0, glowRate, dt);
        this.glow[i] = g.x;
      }
    }
  }

  private advance(i: number, target: number, rate: number, dt: number): number {
    const spring = this.springs[i];
    if (spring === undefined) return 0;
    if (this.drive === "spring") {
      stepSpring(spring, target, rate, dt);
      return spring.x;
    }
    if (Math.abs(target - (this.to[i] ?? 0)) > 0.01) {
      this.from[i] = spring.x;
      this.to[i] = target;
      this.since[i] = 0;
    }
    const t = (this.since[i] ?? 0) + dt;
    this.since[i] = t;
    const from = this.from[i] ?? 0;
    spring.x = from + ((this.to[i] ?? 0) - from) * easeAt(this.curve, Math.min(1, t / this.settle));
    spring.v = 0;
    return spring.x;
  }
}
