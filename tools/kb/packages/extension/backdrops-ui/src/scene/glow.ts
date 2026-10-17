/**
 * The light behind the actors: a soft radial glow (the moon or the sun), the
 * broad wash that holds the rest of the sky, and the dither that keeps the
 * gradient from banding. All of it is painted once into an offscreen canvas
 * when the layout changes, then blitted every frame for nothing.
 */
import { css, type ScenePalette } from "./palette.ts";
import type { Feather } from "./feather.ts";
import { smoothstep } from "./math.ts";
import type { Rng } from "./rng.ts";

export interface GlowSpec {
  /** Centre of the light, CSS pixels. */
  readonly x: number;
  readonly y: number;
  /** Radius of the whole glow, CSS pixels. */
  readonly reach: number;
  /** Radius of the bright disc itself (the moon or sun), CSS pixels. */
  readonly disc: number;
  /** Vertical compression of the glow's reach: 1 round, above 1 a wide, low glow (a sun on a horizon). */
  readonly squash: number;
  /** 0..1: how bright the light is. */
  readonly intensity: number;
  /** Which way the broad wash lies: toward the top (`down` backdrops) or the bottom. */
  readonly washFrom: "top" | "bottom";
}

/** How bright the light is at (x, y), 0..1: what an actor's rim and veil read. */
export function glowAt(spec: GlowSpec, x: number, y: number): number {
  const d = Math.hypot(x - spec.x, (y - spec.y) * spec.squash);
  const fall = 1 - smoothstep(spec.disc * 0.4, spec.reach, d);
  return fall * fall * spec.intensity;
}

/** The eased falloff of every soft layer: 1 at the centre, 0 at `reach`, no visible edge. */
function falloff(distance: number, reach: number): number {
  const t = distance / reach;
  if (t >= 1) return 0;
  const k = 1 - t;
  return k * k * k;
}

/**
 * The soft part of the light, computed per pixel in floats and rounded with
 * noise: an 8-bit gradient stepping through very low alphas bands visibly on
 * a dark page, so the glow is never drawn as a canvas gradient. Layered like
 * light: the broad wash, the halo, the light's own reach. The frame's
 * feather is multiplied in before rounding, so the fade dithers with it.
 */
function paintField(
  spec: GlowSpec,
  palette: ScenePalette,
  size: { width: number; height: number },
  feather: Feather,
  rng: Rng,
): HTMLCanvasElement {
  const width = Math.max(1, Math.round(size.width));
  const height = Math.max(1, Math.round(size.height));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return canvas;
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const { sky, halo, core } = palette;
  for (let y = 0; y < height; y++) {
    const wash = 0.2 * spec.intensity * falloff(spec.washFrom === "top" ? y : height - y, height);
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x - spec.x, (y - spec.y) * spec.squash);
      const aHalo = 0.72 * spec.intensity * falloff(d, spec.reach);
      const aCore = 0.62 * spec.intensity * falloff(d, spec.reach * 0.42);
      // Over, bottom to top: wash, halo, core.
      const a1 = wash;
      const a2 = aHalo + a1 * (1 - aHalo);
      const a3 = aCore + a2 * (1 - aCore);
      if (a3 <= 0.0005) continue;
      const w1 = a1 * (1 - aHalo) * (1 - aCore);
      const w2 = aHalo * (1 - aCore);
      const r = (sky.r * w1 + halo.r * w2 + core.r * aCore) / a3;
      const g = (sky.g * w1 + halo.g * w2 + core.g * aCore) / a3;
      const b = (sky.b * w1 + halo.b * w2 + core.b * aCore) / a3;
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = Math.floor(a3 * feather.at(x, y) * 255 + rng.next());
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Faint darker seas on the moon, and a lit limb: the disc is a world, not a hole. */
function paintMaria(ctx: CanvasRenderingContext2D, spec: GlowSpec, palette: ScenePalette) {
  if (!palette.dark) return;
  const r = spec.disc;
  const seas = [
    [-0.28, -0.22, 0.34],
    [0.2, 0.05, 0.27],
    [-0.1, 0.34, 0.2],
  ] as const;
  for (const [dx, dy, size] of seas) {
    const sea = ctx.createRadialGradient(
      spec.x + dx * r,
      spec.y + dy * r,
      0,
      spec.x + dx * r,
      spec.y + dy * r,
      size * r,
    );
    sea.addColorStop(0, css(palette.body, 0.2 * spec.intensity));
    sea.addColorStop(1, css(palette.body, 0));
    ctx.fillStyle = sea;
    ctx.beginPath();
    ctx.arc(spec.x, spec.y, r * 0.98, 0, Math.PI * 2);
    ctx.fill();
  }
  const limb = ctx.createRadialGradient(
    spec.x - r * 0.2,
    spec.y - r * 0.2,
    r * 0.3,
    spec.x,
    spec.y,
    r,
  );
  limb.addColorStop(0, css(palette.core, 0));
  limb.addColorStop(1, css(palette.body, 0.22 * spec.intensity));
  ctx.fillStyle = limb;
  ctx.beginPath();
  ctx.arc(spec.x, spec.y, r * 0.98, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Paint the glow into a fresh canvas of `width`×`height` CSS pixels at `dpr`.
 * Nothing is drawn where the light does not reach, so the layer sits on the
 * page without a frame.
 */
export function paintGlow(
  spec: GlowSpec,
  palette: ScenePalette,
  frame: { width: number; height: number; dpr: number },
  feather: Feather,
  rng: Rng,
): HTMLCanvasElement {
  const { width, height, dpr } = frame;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext("2d");
  if (ctx === null) return canvas;
  // The soft field is computed at one pixel per CSS pixel and shown at the display's: its grain is the dither.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(paintField(spec, palette, frame, feather, rng), 0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.scale(dpr, dpr);

  // The disc: the moon or sun itself, softly edged; high alpha, so it needs no dither.
  const disc = ctx.createRadialGradient(spec.x, spec.y, 0, spec.x, spec.y, spec.disc * 1.06);
  disc.addColorStop(0, css(palette.core, 0.9 * spec.intensity));
  disc.addColorStop(0.88, css(palette.core, 0.82 * spec.intensity));
  disc.addColorStop(1, css(palette.core, 0));
  ctx.fillStyle = disc;
  ctx.fillRect(0, 0, width, height);
  paintMaria(ctx, spec, palette);
  return canvas;
}
