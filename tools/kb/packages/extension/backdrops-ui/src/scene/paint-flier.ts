/**
 * A flier as the eye meets it: the figure of its species at its wing's phase,
 * placed where it flies, filled with the page's own tone (a far one veiled by
 * haze toward the light), edged with the light caught on its rim, and, for a
 * bat by night, its eyes.
 */
import { batFigure } from "./bat.ts";
import { drawFigure, toScreen, type Ink, type Placement } from "./draw-figure.ts";
import { depthScale, type Flier } from "./flier.ts";
import { BAT_GAIT, SWALLOW_GAIT, cycleAt, wingState } from "./gait.ts";
import type { Feather } from "./feather.ts";
import { glowAt, type GlowSpec } from "./glow.ts";
import { clamp, clamp01 } from "./math.ts";
import { css, type ScenePalette } from "./palette.ts";
import { swallowFigure } from "./swallow.ts";
import type { Figure } from "./figure.ts";

export interface Lit {
  readonly palette: ScenePalette;
  readonly glow: GlowSpec;
  readonly feather: Feather;
  readonly dpr: number;
}

/** How far a flier has turned toward the viewer: 0 side-on, 1 head-on. */
function facingOf(flier: Flier): number {
  return clamp01(1 - Math.abs(flier.turn));
}

function figureOf(flier: Flier): Figure {
  const state = wingState(
    flier.species === "bat" ? BAT_GAIT : SWALLOW_GAIT,
    cycleAt(flier.phase),
    flier.glide,
  );
  const facing = facingOf(flier);
  return flier.species === "bat"
    ? batFigure(state, facing)
    : swallowFigure(state, 0.35 + 0.4 * (1 - flier.glide), facing);
}

function placementOf(flier: Flier): Placement {
  return {
    x: flier.x,
    y: flier.y,
    size: flier.size,
    tilt: flier.tilt,
    mirror: flier.turn >= 0 ? 1 : -1,
    squash: Math.max(0.3, Math.abs(flier.turn)),
  };
}

function inkOf(depth: number, at: Placement, lit: Lit): Ink {
  const light = glowAt(lit.glow, at.x, at.y);
  const fade = lit.feather.at(at.x, at.y);
  const veil = depthScale(depth).veil;
  const gx = lit.glow.x - at.x;
  const gy = lit.glow.y - at.y;
  const d = Math.hypot(gx, gy) || 1;
  const reach = 0.55 + at.size * 0.012;
  return {
    body: css(lit.palette.body),
    membrane: 0.93,
    alpha: (1 - (1 - veil) * (0.55 + 0.45 * light)) * fade,
    rim: {
      color: css(lit.palette.rim),
      strength: clamp01(light * 0.9) * (0.55 - 0.25 * depth) * fade,
      dx: (gx / d) * reach,
      dy: (gy / d) * reach,
    },
  };
}

/** Where an eye is: on the head in profile, and drawn apart across the face as the bat turns to the viewer. */
function eyeAt(at: Placement, eye: Figure["eyes"][number], index: number, facing: number) {
  const side = toScreen(at, eye.x, eye.y);
  const centre = toScreen(at, 0.5, -0.06);
  const apart = 0.085 * at.size * (index === 0 ? -1 : 1);
  return {
    x: side.x + (centre.x + apart - side.x) * facing,
    y: side.y + (centre.y - side.y) * facing,
  };
}

/** Bat eyes: a small warm glow, brighter when the bat faces the viewer, shut when it blinks. */
function drawEyes(
  ctx: CanvasRenderingContext2D,
  figure: Figure,
  at: Placement,
  lit: Lit,
  bearing: Bearing,
) {
  if (bearing.depth > 0.75) return;
  const { facing, open, depth } = bearing;
  const fade = lit.feather.at(at.x, at.y);
  figure.eyes.forEach((eye, index) => {
    const p = eyeAt(at, eye, index, facing);
    const radius = clamp(eye.r * at.size * 1.4, 0.8, 2.2);
    const strength = eye.weight * open * (0.55 + 0.45 * facing) * (1 - 0.7 * depth) * fade;
    if (strength < 0.02) return;
    ctx.setTransform(lit.dpr, 0, 0, lit.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = css(lit.palette.eye, 0.16 * strength);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius * 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css(
      facing > 0.35 ? lit.palette.eyeHot : lit.palette.eye,
      Math.min(1, strength),
    );
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** What paints a figure besides where it is: who it is, how far, how awake its eyes are. */
interface Bearing {
  readonly bat: boolean;
  readonly depth: number;
  /** 0 side-on … 1 head-on. */
  readonly facing: number;
  /** 0 eyes shut … 1 open. */
  readonly open: number;
}

/** A figure at a placement, in the page's tone, edged by the glow, with a bat's eyes by night. */
function paintFigure(
  ctx: CanvasRenderingContext2D,
  figure: Figure,
  at: Placement,
  lit: Lit,
  bearing: Bearing,
): void {
  drawFigure(ctx, figure, at, inkOf(bearing.depth, at, lit), lit.dpr);
  if (bearing.bat && lit.palette.dark) drawEyes(ctx, figure, at, lit, bearing);
  ctx.globalAlpha = 1;
}

export function paintFlier(ctx: CanvasRenderingContext2D, flier: Flier, lit: Lit): void {
  paintFigure(ctx, figureOf(flier), placementOf(flier), lit, {
    bat: flier.species === "bat",
    depth: flier.depth,
    facing: facingOf(flier),
    open: 1 - flier.blink,
  });
}
