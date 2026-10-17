/**
 * A wing in three dimensions, drawn in two. A planform lives in the wing's
 * own plane: `s` along the span from the shoulder, `t` back along the chord.
 * The beat swings that plane about the body's axis by `beat` (up positive),
 * each point by its own amount so the tip bends and lags; the plane is swept
 * back by `sweep`; and the camera looks from slightly above, so a wing
 * pointing at the viewer is short and one on the far side rises above the
 * back, exactly as a real beat looks from the side.
 */
import type { Poly } from "./figure.ts";

export interface WingPose {
  /** The plane's angle above horizontal, radians (up positive). */
  readonly beat: number;
  /** How far the tip lags the root: bends against the stroke, radians at the tip. */
  readonly bend: number;
  /** Swept back, radians. */
  readonly sweep: number;
  /** 0 folded, 1 open. */
  readonly spread: number;
  /** +1 the wing nearest the viewer, -1 the far one. */
  readonly side: 1 | -1;
  /** Where the shoulder sits, in figure units. */
  readonly shoulder: readonly [number, number];
}

/** A point of the planform, in wing units. */
export type PlanPoint = readonly [s: number, t: number];

/** How high the camera sits above the animal's plane: the lower the flatter. */
const ELEVATION = 0.42;
const COS_E = Math.cos(ELEVATION);
const SIN_E = Math.sin(ELEVATION);

/** The projected point (into `out`) of planform point `p` for `pose`. `reach` is s / full span, for the bend. */
export function projectWingPoint(
  out: Poly,
  p: PlanPoint,
  pose: WingPose,
  reach: number,
  scale: number,
): void {
  const [s, t] = p;
  const cs = Math.cos(pose.sweep);
  const ss = Math.sin(pose.sweep);
  // The plane at rest (beat 0): span u = (-sin, cos, 0), chord c = (-cos, -sin, 0).
  const x = -ss * s - cs * t;
  const yFlat = cs * s - ss * t;
  // Swing the plane about the x axis by the beat, bent toward the tip.
  const angle = pose.beat + pose.bend * reach * reach;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const y = yFlat * ca * pose.side;
  const z = yFlat * sa;
  out.push(pose.shoulder[0] + x * scale, pose.shoulder[1] - (z * COS_E - y * SIN_E) * scale);
}

/** The wing's whole planform: every point projected in turn. */
export function projectPlan(
  plan: readonly PlanPoint[],
  pose: WingPose,
  span: number,
  scale: number,
): Poly {
  const out: Poly = [];
  for (const p of plan) projectWingPoint(out, p, pose, p[0] / span, scale);
  return out;
}
