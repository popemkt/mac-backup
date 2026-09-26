/**
 * A scene's ground (Lab principles P1, L1, L3, L4): the one backdrop every
 * real-time 3D view stands on, through the stage's `backdrop(options)`.
 *
 * A screen-space backdrop in the palette: the ground pooled at a focal
 * point, falling to the edge colour at the frame — with no options, that
 * plain radial is all it is. `warmth` lets the accent warm the pool, `haze`
 * drifts a slow, domain-warped cloud in the hue family over it, and `rise`
 * turns the drift upward and adds a fine shimmer — heat haze over a fire. The
 * post chain's dither keeps the dark falloff from banding (L4).
 */
import {
  exp,
  float,
  length,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  screenSize,
  screenUV,
  smoothstep,
  vec2,
  vec3,
} from "three/tsl";
import type { PaletteUniforms } from "@/scene/gpu/stage";
import type { TslNode } from "@/scene/gpu/tsl";

export interface BackdropOptions {
  /** Where the light pools, in screen UV (0.5, 0.5 is the centre). */
  readonly focus?: readonly [number, number];
  /** How much the accent warms the pool, 0–1 (none by default). */
  readonly warmth?: number;
  /** How much cloud drifts over the ground, 0–1 (none by default). */
  readonly haze?: number;
  /** Heat: the cloud rises and shimmers, 0–1. */
  readonly rise?: number;
}

/** The backdrop's colour for this pixel, for `scene.backgroundNode`. `time` in seconds. */
export function backdropNode(
  colors: PaletteUniforms,
  time: TslNode,
  options: BackdropOptions = {},
): TslNode {
  const [fx, fy] = options.focus ?? [0.5, 0.5];
  const warmth = options.warmth ?? 0;
  const haze = options.haze ?? 0;
  const rise = options.rise ?? 0;
  const aspect = screenSize.x.div(screenSize.y);
  const p = screenUV.sub(vec2(fx, fy)).mul(vec2(aspect, 1));
  const r = length(p);
  const ground = mix(colors.ground, colors.edge, smoothstep(0.08, 1.15, r));
  const pool = exp(r.mul(r).mul(-4));
  const warmed = mix(ground, mix(colors.ground, colors.accent, 0.4), pool.mul(warmth * 0.45));
  // Domain-warped cloud: one slow field bends the coordinates of a finer one.
  const drift = time.mul(0.012);
  const q = vec3(p.x.mul(1.4), p.y.mul(1.4).add(time.mul(rise * 0.035)), drift);
  const warp = mx_fractal_noise_float(q.mul(0.6), 3, 2, 0.5, 1);
  const cloud = mx_fractal_noise_float(q.add(vec3(warp.mul(0.7), warp.mul(0.9), 0)), 5, 2, 0.55, 1)
    .mul(0.5)
    .add(0.5);
  const wisps = smoothstep(0.38, 0.95, cloud).mul(float(1).sub(smoothstep(0.3, 1.3, r).mul(0.6)));
  const tint = mix(colors.ground, mix(colors.hue, colors.ink, 0.12), 0.55);
  const clouded = mix(warmed, tint, wisps.mul(haze * 0.32));
  if (rise === 0) return haze === 0 ? warmed : clouded;
  // Heat shimmer: a fine, fast, rising ripple in the warm pool only.
  const ripple = mx_noise_float(vec3(p.x.mul(11), p.y.mul(6).sub(time.mul(0.7)), time.mul(0.35)));
  return clouded.mul(
    ripple
      .mul(pool)
      .mul(rise * 0.05)
      .add(1),
  );
}
