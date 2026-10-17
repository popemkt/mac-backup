/**
 * Roost: a house with a long overhang, and bats hanging under its eave. By
 * day they sleep, wrapped in their wings, breathing; now and then one
 * stretches, shuffles along the beam, or drops, flutters and hangs again,
 * and a swallow may dart past. By night the same house at dusk: some bats are
 * still hanging with their eyes open and glinting, others peel off the eave,
 * circle the house and return, and one window glows. A composition over the
 * scene kit (`../scene`), as Sky is.
 */
import type { Composition, CompositionFactory, SceneConfig } from "../scene/composition";
import {
  drawDust,
  drawStars,
  paintRays,
  scatterMotes,
  type Mote,
  type Weather,
} from "../scene/atmosphere";
import { batFigure } from "../scene/bat";
import { drawFigure, type Placement } from "../scene/draw-figure";
import { featherOf, type Feather } from "../scene/feather";
import { wound, type Figure, type Poly } from "../scene/figure";
import { newFlier, type Flier } from "../scene/flier";
import { stepFliers, type Air } from "../scene/flock";
import { BAT_GAIT, blendWing, cycleAt, hangState, wingState } from "../scene/gait";
import { glowAt, paintGlow } from "../scene/glow";
import { clamp01, lerp, smoothstep } from "../scene/math";
import { rareMoments, type Moments } from "../scene/moments";
import { css } from "../scene/palette";
import { paintFigure, paintFlier, type Lit } from "../scene/paint-flier";
import type { Reactions } from "../scene/reactions";
import { seededRng, type Rng } from "../scene/rng";
import { houseOf, type House } from "./house";
import {
  HANG_TILT,
  advance,
  hangPlace,
  letGo,
  shiverOf,
  spawnRoosters,
  stretchOf,
  type Rooster,
  type RoostWorld,
} from "./roosters";

const BATS = { subtle: 5, soft: 8, vivid: 11 } as const;
const MOTES = { subtle: 14, soft: 24, vivid: 34 } as const;

interface World {
  readonly config: SceneConfig;
  readonly house: House;
  readonly feather: Feather;
  readonly glowSprite: HTMLCanvasElement;
  readonly rays: HTMLCanvasElement | null;
  readonly motes: Mote[];
  readonly roosters: Rooster[];
  readonly visitors: Flier[];
}

interface Roost {
  readonly rng: Rng;
  readonly outings: Moments;
  readonly flutters: Moments;
  readonly visits: Moments;
  world: World | null;
  time: number;
  sawNavigate: number;
}

function batCount(config: SceneConfig): number {
  return Math.max(3, Math.round(BATS[config.strength] * config.quality));
}

/** `count` places along the eave, evenly spread and then nudged, none closer than a bat is wide. */
function slotsAlong(rng: Rng, house: House, count: number): number[] {
  const { from, to } = house.eave;
  const step = (to - from) / count;
  return Array.from({ length: count }, (_, i) => from + step * (i + 0.5 + rng.range(-0.28, 0.28)));
}

function buildWorld(rng: Rng, config: SceneConfig, before: World | null, now: number): World {
  const { palette, dpr } = config;
  const house = houseOf(config.width, config.height, config.direction, palette.dark);
  const feather = featherOf(config.width, config.height, config.direction);
  const count = batCount(config);
  const keep = before !== null && before.config.palette.dark === palette.dark;
  const roosters =
    keep && before.roosters.length === count
      ? before.roosters
      : spawnRoosters(rng, slotsAlong(rng, house, count), house.eave.y, now, palette.dark);
  for (const r of roosters) {
    // A resize or a new look moves the eave: hanging bats hang from the new one.
    r.slotX = Math.min(Math.max(r.slotX, house.eave.from), house.eave.to);
    r.goalX = r.slotX;
  }
  return {
    config,
    house,
    feather,
    glowSprite: paintGlow(house.glow, palette, config, feather, rng),
    rays: palette.dark ? null : paintRays(palette, house.glow.reach * 1.6, dpr),
    motes: scatterMotes(
      rng,
      Math.round(MOTES[config.strength] * config.quality),
      config.width,
      config.height,
      { x: house.glow.x, y: house.glow.y, r: house.glow.reach * 0.25 },
    ),
    roosters,
    visitors: [],
  };
}

function airOf(world: World, time: number): Air {
  const { width, height } = world.config;
  return {
    arena: { width, height },
    time,
    anchor: { x: width * 0.58, y: world.house.eave.y + height * 0.1, radius: width * 0.2 },
  };
}

/** A bat's room along the beam: no neighbour nearer than the two of them are wide. */
function roomFor(world: World): RoostWorld["room"] {
  return (r, x) =>
    x >= world.house.eave.from &&
    x <= world.house.eave.to &&
    world.roosters.every(
      (o) => o === r || Math.abs(o.goalX - x) > (o.flier.size + r.flier.size) * 0.55,
    );
}

function hanging(world: World): Rooster[] {
  return world.roosters.filter((r) => r.mode === "hang");
}

/** Someone lets go: by night to circle the house, by day to flutter a moment and return. */
function launch(roost: Roost, world: World, outFor: number): void {
  const free = hanging(world);
  const r = free[roost.rng.int(0, free.length - 1)];
  if (r === undefined) return;
  letGo(r, roost.time, outFor, hangPlace(r, world.house.eave.y));
}

/** A rare swallow, darting past the eaves. */
function visit(roost: Roost, world: World): void {
  const { rng } = roost;
  const { width, height } = world.config;
  const dir = rng.chance(0.5) ? 1 : -1;
  const swallow = newFlier(rng, 100 + world.visitors.length, "swallow", 0.15, {
    x: dir === 1 ? -50 : width + 50,
    y: world.house.eave.y + height * rng.range(0.1, 0.34),
  });
  swallow.life = 1e9;
  swallow.vx = dir * swallow.cruise * 2;
  swallow.vy = 0;
  swallow.turn = dir;
  swallow.task = { kind: "cross", dir, until: roost.time + 30 };
  world.visitors.push(swallow);
}

/** A write lands: one hanging bat shuffles. */
function stirOne(roost: Roost, world: World): void {
  const free = hanging(world);
  const r = free[roost.rng.int(0, free.length - 1)];
  if (r !== undefined) r.shiver = { at: roost.time, length: 1.2 };
}

/** A move to another page: a ripple of small stirs along the row, left to right. */
function ripple(roost: Roost, world: World): void {
  const { from, to } = world.house.eave;
  for (const r of world.roosters) {
    r.rippleAt = roost.time + 0.1 + ((r.slotX - from) / (to - from)) * 0.9;
  }
}

function stepRoost(roost: Roost, dt: number, reactions: Reactions): void {
  const { world, rng } = roost;
  if (world === null) return;
  roost.time += dt;
  const { time } = roost;
  const dark = world.config.palette.dark;
  const since = reactions.sinceNavigate();
  if (since < roost.sawNavigate && since < 0.05) ripple(roost, world);
  roost.sawNavigate = since;
  if (reactions.stir > 0.6 && rng.chance(dt * 4)) stirOne(roost, world);
  if (reactions.calm < 0.3) {
    if (dark && roost.outings.due(time)) launch(roost, world, rng.range(9, 26));
    if (!dark && roost.flutters.due(time)) launch(roost, world, rng.range(3, 5));
    if (!dark && roost.visits.due(time)) visit(roost, world);
  }
  const rest: RoostWorld = {
    time,
    eaveY: world.house.eave.y,
    dark,
    reactions,
    rng,
    room: roomFor(world),
  };
  for (const r of world.roosters) advance(r, dt, rest, world.house.eave.y);
  const aloft = world.roosters
    .filter((r) => r.mode === "drop" || r.mode === "out" || r.mode === "return")
    .map((r) => r.flier);
  stepFliers([...aloft, ...world.visitors], airOf(world, time), dt, reactions, rng);
  const { width } = world.config;
  const gone = world.visitors.filter((v) => v.x < -90 || v.x > width + 90);
  for (const v of gone) world.visitors.splice(world.visitors.indexOf(v), 1);
}

function centroid(poly: Poly): { x: number; y: number } {
  let x = 0;
  let y = 0;
  const n = poly.length / 2;
  for (let i = 0; i < poly.length; i += 2) {
    x += poly[i] ?? 0;
    y += poly[i + 1] ?? 0;
  }
  return { x: x / n, y: y / n };
}

const IDENTITY: Placement = { x: 0, y: 0, size: 1, tilt: 0, mirror: 1, squash: 1 };

/** One piece of the house in the page's tone, with a rim on the edge toward the light. */
function drawPiece(ctx: CanvasRenderingContext2D, world: World, poly: Poly, lit: Lit): void {
  const { house, config } = world;
  const at = centroid(poly);
  const light = glowAt(house.glow, at.x, at.y);
  const gx = house.glow.x - at.x;
  const gy = house.glow.y - at.y;
  const d = Math.hypot(gx, gy) || 1;
  const figure: Figure = { membranes: [], solids: [wound(poly)], struts: [], eyes: [] };
  const rim = {
    color: css(config.palette.rim),
    strength: clamp01(light) * 0.7 * world.feather.at(at.x, at.y),
    dx: (gx / d) * 1.1,
    dy: (gy / d) * 1.1,
  };
  drawFigure(
    ctx,
    figure,
    IDENTITY,
    { body: css(config.palette.body), membrane: 1, alpha: 1, rim },
    lit.dpr,
  );
}

/** The wall: the page's tone at the eave, dissolving into the sky below, so no foot shows. */
function drawWall(ctx: CanvasRenderingContext2D, world: World, lit: Lit): void {
  const { wall } = world.house;
  let top = Infinity;
  let bottom = -Infinity;
  for (let i = 1; i < wall.length; i += 2) {
    top = Math.min(top, wall[i] ?? 0);
    bottom = Math.max(bottom, wall[i] ?? 0);
  }
  ctx.setTransform(lit.dpr, 0, 0, lit.dpr, 0, 0);
  const fade = ctx.createLinearGradient(0, top, 0, bottom);
  fade.addColorStop(0, css(world.config.palette.body, 1));
  fade.addColorStop(0.55, css(world.config.palette.body, 0.8));
  fade.addColorStop(1, css(world.config.palette.body, 0));
  ctx.fillStyle = fade;
  ctx.beginPath();
  for (let i = 0; i < wall.length; i += 2) {
    if (i === 0) ctx.moveTo(wall[0] ?? 0, wall[1] ?? 0);
    else ctx.lineTo(wall[i] ?? 0, wall[i + 1] ?? 0);
  }
  ctx.closePath();
  ctx.fill();
}

/** The house, in the page's tone: only the light behind it, and a rim on the edge toward it, draws it. */
function drawHouse(ctx: CanvasRenderingContext2D, world: World, lit: Lit): void {
  for (const poly of [...world.house.roof, ...world.house.posts]) drawPiece(ctx, world, poly, lit);
  drawWall(ctx, world, lit);
}

/** The one lit window of a night: warm, softly breathing, its frame in the page's own tone. */
function drawWindow(ctx: CanvasRenderingContext2D, world: World, time: number, lit: Lit): void {
  if (!lit.palette.dark) return;
  const { x, y, width, height } = world.house.window;
  const glow = 0.82 + 0.1 * Math.sin(time * 0.9) + 0.05 * Math.sin(time * 2.3 + 1);
  const fade = world.feather.at(x + width / 2, y + height / 2);
  ctx.setTransform(lit.dpr, 0, 0, lit.dpr, 0, 0);
  const bloom = ctx.createRadialGradient(
    x + width / 2,
    y + height / 2,
    0,
    x + width / 2,
    y + height / 2,
    width * 2.4,
  );
  bloom.addColorStop(0, css(lit.palette.window, 0.22 * glow * fade));
  bloom.addColorStop(1, css(lit.palette.window, 0));
  ctx.fillStyle = bloom;
  ctx.fillRect(x - width * 2.4, y - width * 2.4, width * 6, height + width * 4.8);
  ctx.fillStyle = css(lit.palette.window, 0.55 * glow * fade);
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = css(lit.palette.body);
  ctx.globalAlpha = fade;
  ctx.fillRect(x + width / 2 - 1.2, y, 2.4, height);
  ctx.fillRect(x, y + height * 0.46, width, 2.4);
  ctx.globalAlpha = 1;
}

/** One hanging, letting-go or flying rooster, in whichever pose its hold gives it. */
function drawRooster(
  ctx: CanvasRenderingContext2D,
  r: Rooster,
  world: World,
  time: number,
  lit: Lit,
) {
  const { flier } = r;
  const eased = smoothstep(0, 1, r.hold);
  const fly = wingState(BAT_GAIT, cycleAt(flier.phase), flier.glide);
  const rest = hangState(r.wrap, stretchOf(r, time));
  const wing = blendWing(fly, rest, eased);
  const home = hangPlace(r, world.house.eave.y);
  const breathe = 1 + 0.014 * Math.sin(r.breath * 2.6);
  const sway = Math.sin(time * 0.6 + r.id * 1.7) * 0.025 + shiverOf(r, time);
  const at: Placement = {
    x: lerp(flier.x, home.x, eased),
    y: lerp(flier.y, home.y, eased),
    size: flier.size * breathe,
    tilt: lerp(flier.tilt, HANG_TILT + sway, eased),
    mirror: flier.turn >= 0 ? 1 : -1,
    squash: lerp(Math.max(0.3, Math.abs(flier.turn)), 0.8, eased),
  };
  paintFigure(ctx, batFigure(wing, lerp(0.4, 0.75, eased)), at, lit, {
    bat: true,
    depth: 0.1,
    facing: lerp(Math.max(0, 1 - Math.abs(flier.turn)), 0.8, eased),
    open: r.open * (1 - flier.blink * (1 - eased)),
  });
}

function drawLight(ctx: CanvasRenderingContext2D, world: World, time: number): void {
  const { house, config } = world;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.94 + 0.06 * Math.sin(time * 0.33);
  ctx.drawImage(world.glowSprite, 0, 0);
  if (world.rays !== null) {
    const size = house.glow.reach * 1.6;
    ctx.setTransform(
      config.dpr,
      0,
      0,
      config.dpr,
      house.glow.x * config.dpr,
      house.glow.y * config.dpr,
    );
    ctx.rotate(time * 0.01);
    ctx.globalAlpha = 0.7 + 0.2 * Math.sin(time * 0.45);
    ctx.drawImage(world.rays, -size / 2, -size / 2, size, size);
  }
  ctx.globalAlpha = 1;
}

function drawRoost(ctx: CanvasRenderingContext2D, world: World, time: number): void {
  const { config, house, feather } = world;
  const { palette, dpr } = config;
  drawLight(ctx, world, time);
  const weather: Weather = {
    palette,
    time,
    dpr,
    feather,
    width: config.width,
    height: config.height,
  };
  if (palette.dark) drawStars(ctx, world.motes, weather);
  else drawDust(ctx, world.motes, weather);
  const lit: Lit = { palette, glow: house.glow, feather, dpr };
  drawHouse(ctx, world, lit);
  drawWindow(ctx, world, time, lit);
  for (const r of world.roosters) drawRooster(ctx, r, world, time, lit);
  for (const visitor of world.visitors) paintFlier(ctx, visitor, lit);
}

export const createRoost: CompositionFactory = (seed): Composition => {
  const rng = seededRng(seed);
  const roost: Roost = {
    rng,
    outings: rareMoments(rng, 13, 5, rng.range(4, 9)),
    flutters: rareMoments(rng, 80, 40, rng.range(25, 50)),
    visits: rareMoments(rng, 75, 45, rng.range(30, 60)),
    world: null,
    time: 0,
    sawNavigate: Infinity,
  };
  return {
    configure: (config) => {
      roost.world = buildWorld(rng, config, roost.world, roost.time);
    },
    step: (dt, reactions) => stepRoost(roost, dt, reactions),
    draw: (ctx) => {
      if (roost.world !== null) drawRoost(ctx, roost.world, roost.time);
    },
    settle: (reactions) => {
      for (let i = 0; i < 90; i++) stepRoost(roost, 1 / 30, reactions);
    },
  };
};
