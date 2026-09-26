/**
 * Where the Glass study's blobs are: plain arithmetic, run on the CPU once a
 * frame and handed to the shader as a uniform array.
 *
 * Six blobs drift on Lissajous paths — sums of slow sines, each period at
 * least the ambient period (M4), so the drift is never busy — and a seventh
 * follows the pointer on a critically damped spring (M1, M5), so it can be
 * pushed through the others to watch them merge. While the pointer is away
 * the seventh returns to the middle.
 */
import { springRate, stepSpring, type Spring, type Timing } from "@/lib/timing";

/** A blob: where it is and how big (world units). */
export interface Blob {
  x: number;
  y: number;
  z: number;
  radius: number;
}

interface Path {
  readonly reach: readonly [number, number, number];
  /** Periods in seconds, one per axis. */
  readonly periods: readonly [number, number, number];
  readonly phase: readonly [number, number, number];
  readonly radius: number;
}

/** The drifting blobs' paths: periods are multiples of the ambient period. */
function paths(ambient: number): readonly Path[] {
  const p = (a: number, b: number, c: number) => [ambient * a, ambient * b, ambient * c] as const;
  return [
    { reach: [1.5, 0.9, 0.8], periods: p(1, 1.3, 1.7), phase: [0, 1.1, 2.3], radius: 0.95 },
    { reach: [1.2, 1.1, 0.9], periods: p(1.4, 1.1, 1.9), phase: [2.1, 0.4, 1.2], radius: 0.8 },
    { reach: [1.7, 0.7, 1], periods: p(1.2, 1.6, 1.1), phase: [4, 2.7, 0.5], radius: 0.7 },
    { reach: [0.9, 1.3, 0.7], periods: p(1.8, 1.25, 1.45), phase: [1.3, 3.9, 3.1], radius: 0.62 },
    { reach: [1.4, 1, 1.1], periods: p(1.1, 1.9, 1.35), phase: [5.2, 1.8, 4.4], radius: 0.55 },
    { reach: [1, 0.8, 1.2], periods: p(1.65, 1.05, 1.2), phase: [3.3, 5.5, 2.2], radius: 0.5 },
  ];
}

function wave(path: Path, axis: 0 | 1 | 2, t: number): number {
  return path.reach[axis] * Math.sin((t * Math.PI * 2) / path.periods[axis] + path.phase[axis]);
}

export const BLOB_COUNT = 7;
const HELD_RADIUS = 0.6;

/**
 * The sphere every blob stays inside: the march skips rays that miss it, so
 * it is the one bound — the drifting paths are chosen within it, and the
 * held blob's aim is clamped to it.
 */
export const BLOB_BOUNDS = 3.8;
/** How far the held blob's centre may go: its whole sphere stays in bounds. */
const HELD_REACH = BLOB_BOUNDS - HELD_RADIUS - 0.05;

/** The shortest period any drifting blob moves on (the M4 bound, for a test). */
export function shortestPeriod(timing: Timing): number {
  return Math.min(...paths(timing.ambientPeriod).flatMap((path) => path.periods));
}

export class BlobField {
  readonly blobs: Blob[];
  private readonly paths: readonly Path[];
  private readonly hx: Spring = { x: 0, v: 0 };
  private readonly hy: Spring = { x: 0, v: 0 };
  private readonly hz: Spring = { x: 0, v: 0 };
  private readonly rate: number;

  constructor(timing: Timing) {
    this.paths = paths(timing.ambientPeriod);
    this.rate = springRate(timing.follow);
    this.blobs = Array.from({ length: BLOB_COUNT }, (_, i) => ({
      x: 0,
      y: 0,
      z: 0,
      radius: this.paths[i]?.radius ?? HELD_RADIUS,
    }));
    this.step(0, 0, null);
  }

  /** One frame at clock `t`; `aim` is the pointer's point, or null while it is away. */
  step(
    dt: number,
    t: number,
    aim: { readonly x: number; readonly y: number; readonly z: number } | null,
  ): void {
    for (let i = 0; i < this.paths.length; i++) {
      const path = this.paths[i];
      const blob = this.blobs[i];
      if (path === undefined || blob === undefined) continue;
      blob.x = wave(path, 0, t);
      blob.y = wave(path, 1, t);
      blob.z = wave(path, 2, t);
    }
    const held = this.blobs[BLOB_COUNT - 1];
    if (held === undefined || dt <= 0) return;
    // The pointer can reach past the bounds at a far dolly; the blob stops at the edge.
    const reach = aim === null ? 0 : Math.hypot(aim.x, aim.y, aim.z);
    const keep = reach > HELD_REACH ? HELD_REACH / reach : 1;
    stepSpring(this.hx, (aim?.x ?? 0) * keep, this.rate, dt);
    stepSpring(this.hy, (aim?.y ?? 0) * keep, this.rate, dt);
    stepSpring(this.hz, (aim?.z ?? 0) * keep, this.rate, dt);
    held.x = this.hx.x;
    held.y = this.hy.x;
    held.z = this.hz.x;
  }
}
