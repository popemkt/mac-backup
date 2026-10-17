/**
 * The light behind the actors: a soft radial glow (the moon or the sun), the
 * broad wash that holds the rest of the sky, and the dither that keeps the
 * gradient from banding. All of it is painted once into an offscreen canvas
 * when the layout changes, then blitted every frame for nothing.
 */
import { css, type ScenePalette } from "./palette.ts";
import type { Feather } from "./feather.ts";
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
  /** How fast the light falls away: higher keeps it near its source (a night's moon), lower spreads it (a day's sun). */
  readonly power: number;
  /** 0..1: how bright the light is. */
  readonly intensity: number;
  /** Which way the broad wash lies: toward the top (`down` backdrops) or the bottom. */
  readonly washFrom: "top" | "bottom";
}

/** How bright the light is at (x, y), 0..1: what an actor's rim and veil read. */
export function glowAt(spec: GlowSpec, x: number, y: number): number {
  const d = Math.hypot(x - spec.x, (y - spec.y) * spec.squash);
  return falloff(d, spec.reach, spec.power) * spec.intensity;
}

/** The eased falloff of every soft layer: 1 at the centre, 0 at `reach`, no visible edge; `power` how fast. */
function falloff(distance: number, reach: number, power: number): number {
  const t = distance / reach;
  return t >= 1 ? 0 : (1 - t) ** power;
}

/**
 * The soft part of the light, computed per pixel in floats and dithered: an
 * 8-bit gradient stepping through very low alphas bands visibly on a dark
 * page, and a transparent canvas cannot be dithered at all (the browser
 * rounds its premultiplied colour), so the glow is never drawn as a canvas
 * gradient and never as a faint alpha. It is composited against the page's
 * own tone here, in floats, and the *colour* is rounded with noise; the
 * alpha is only the frame's feather, so the edge dissolves into the page.
 * Layered like light: the broad wash, the halo, the light's own reach.
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
  const { sky, halo, core, body } = palette;
  const { power } = spec;
  const heart = palette.dark ? 0.5 : 0.28;
  for (let y = 0; y < height; y++) {
    const wash =
      0.04 * spec.intensity * falloff(spec.washFrom === "top" ? y : height - y, height, 3);
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x - spec.x, (y - spec.y) * spec.squash);
      const aHalo = Math.min(1, 0.72 * spec.intensity * falloff(d, spec.reach, power));
      const aCore = Math.min(1, heart * spec.intensity * falloff(d, spec.reach * 0.4, power));
      // Over, bottom to top, against the page: wash, halo, core.
      let r = body.r + (sky.r - body.r) * wash;
      let g = body.g + (sky.g - body.g) * wash;
      let b = body.b + (sky.b - body.b) * wash;
      r += (halo.r - r) * aHalo;
      g += (halo.g - g) * aHalo;
      b += (halo.b - b) * aHalo;
      r += (core.r - r) * aCore;
      g += (core.g - g) * aCore;
      b += (core.b - b) * aCore;
      const i = (y * width + x) * 4;
      data[i] = Math.floor(r + rng.next());
      data[i + 1] = Math.floor(g + rng.next());
      data[i + 2] = Math.floor(b + rng.next());
      data[i + 3] = Math.floor(feather.at(x, y) * 255 + rng.next());
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

  // The disc: a moon is a softly edged disc; a sun is only a brighter bloom, never a sticker.
  const bloom = !palette.dark;
  const radius = spec.disc * (bloom ? 2.1 : 1.06);
  const disc = ctx.createRadialGradient(spec.x, spec.y, 0, spec.x, spec.y, radius);
  if (bloom) {
    disc.addColorStop(0, css(palette.core, 0.5 * spec.intensity));
    disc.addColorStop(0.35, css(palette.core, 0.34 * spec.intensity));
    disc.addColorStop(0.7, css(palette.core, 0.1 * spec.intensity));
    disc.addColorStop(1, css(palette.core, 0));
  } else {
    disc.addColorStop(0, css(palette.core, 0.9 * spec.intensity));
    disc.addColorStop(0.88, css(palette.core, 0.82 * spec.intensity));
    disc.addColorStop(1, css(palette.core, 0));
  }
  ctx.fillStyle = disc;
  ctx.fillRect(0, 0, width, height);
  paintMaria(ctx, spec, palette);
  return canvas;
}
