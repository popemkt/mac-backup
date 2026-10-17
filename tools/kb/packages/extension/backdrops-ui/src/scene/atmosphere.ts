/**
 * The air around the actors: stars that twinkle by night, dust that drifts in
 * the sun by day, a thin cloud wisp crossing the light, soft rays. Each is
 * painted once into a sprite where it can be, and moved by `time` alone.
 */
import { TAU, clamp01 } from "./math.ts";
import type { Feather } from "./feather.ts";
import { css, type Rgb, type ScenePalette } from "./palette.ts";
import type { Rng } from "./rng.ts";

/** What the air is doing to a mote: the scene's palette and clock, the display, and the frame's edge. */
export interface Weather {
  readonly palette: ScenePalette;
  readonly time: number;
  readonly dpr: number;
  readonly feather: Feather;
  readonly width: number;
  readonly height: number;
}

export interface Mote {
  x: number;
  y: number;
  /** Radius, CSS pixels. */
  r: number;
  phase: number;
  /** Twinkle or drift rate. */
  rate: number;
}

/** `count` motes scattered over the frame, none in the light's heart. */
export function scatterMotes(
  rng: Rng,
  count: number,
  width: number,
  height: number,
  avoid: { x: number; y: number; r: number },
): Mote[] {
  const motes: Mote[] = [];
  let guard = 0;
  while (motes.length < count && guard++ < count * 8) {
    const x = rng.range(0, width);
    const y = rng.range(0, height);
    if (Math.hypot(x - avoid.x, y - avoid.y) < avoid.r) continue;
    motes.push({
      x,
      y,
      r: rng.range(0.5, 1.3),
      phase: rng.range(0, TAU),
      rate: rng.range(0.25, 0.9),
    });
  }
  return motes;
}

/** Stars: fixed in the sky, twinkling slowly and never all at once. */
export function drawStars(
  ctx: CanvasRenderingContext2D,
  motes: readonly Mote[],
  weather: Weather,
): void {
  ctx.setTransform(weather.dpr, 0, 0, weather.dpr, 0, 0);
  ctx.fillStyle = css(weather.palette.mote);
  for (const star of motes) {
    const twinkle = 0.5 + 0.5 * Math.sin(weather.time * star.rate * 1.7 + star.phase);
    ctx.globalAlpha = (0.12 + 0.5 * twinkle * twinkle) * weather.feather.at(star.x, star.y);
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Dust in the sun: drifting up and across, and fading at the ends of its drift. */
export function drawDust(
  ctx: CanvasRenderingContext2D,
  motes: readonly Mote[],
  weather: Weather,
): void {
  const { time, height } = weather;
  ctx.setTransform(weather.dpr, 0, 0, weather.dpr, 0, 0);
  ctx.fillStyle = css(weather.palette.mote);
  for (const dust of motes) {
    const cycle = (time * dust.rate * 0.012 + dust.phase / TAU) % 1;
    const x = dust.x + Math.sin(time * 0.2 * dust.rate + dust.phase) * 14 + cycle * 18;
    const y = height - cycle * height * 0.9 + (dust.y - height * 0.5) * 0.2;
    ctx.globalAlpha =
      0.5 * Math.sin(cycle * Math.PI) * clamp01(dust.r - 0.2) * weather.feather.at(x, y);
    ctx.beginPath();
    ctx.arc(x, y, dust.r * 1.2, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * A thin wisp of cloud, `width`×`height` CSS pixels, of `tone`: soft ellipses
 * strung along a line. Drawn in the page's own tone it is a silhouette like
 * every other actor, and shows only where it crosses the light.
 */
export function paintWisp(
  rng: Rng,
  tone: Rgb,
  width: number,
  height: number,
  dpr: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  if (ctx === null) return canvas;
  ctx.scale(dpr, dpr);
  const lumps = 13;
  for (let i = 0; i < lumps; i++) {
    const t = i / (lumps - 1);
    const rx = width * rng.range(0.07, 0.15);
    const ry = height * rng.range(0.1, 0.22);
    const cx = width * (0.1 + 0.8 * t) + rng.range(-8, 8);
    const cy = height * (0.5 + 0.18 * Math.sin(t * 3.1 + rng.range(0, 1))) + rng.range(-3, 3);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gradient.addColorStop(0, css(tone, 0.42));
    gradient.addColorStop(0.55, css(tone, 0.16));
    gradient.addColorStop(1, css(tone, 0));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  return canvas;
}

/** Soft rays from a point: a square sprite of `size` CSS pixels, turned slowly by the caller. */
export function paintRays(palette: ScenePalette, size: number, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(size * dpr);
  canvas.height = canvas.width;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return canvas;
  ctx.scale(dpr, dpr);
  const half = size / 2;
  const wedges = 11;
  const rays = ctx.createConicGradient(0.3, half, half);
  for (let i = 0; i <= wedges * 2; i++) {
    const strength = i % 2 === 0 ? 0 : 0.5 + 0.5 * Math.sin(i * 1.7);
    rays.addColorStop(i / (wedges * 2), css(palette.core, 0.06 * strength));
  }
  ctx.fillStyle = rays;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "destination-in";
  const fade = ctx.createRadialGradient(half, half, half * 0.08, half, half, half);
  fade.addColorStop(0, "rgba(0, 0, 0, 1)");
  fade.addColorStop(0.5, "rgba(0, 0, 0, 0.35)");
  fade.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
