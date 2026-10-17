/**
 * Sky: the open sky. By night bats fly against a low moon glow, by day
 * swallows against a sun glow, over stars or dust and a wisp of cloud
 * crossing the light. A composition over the scene kit (`../scene`): it
 * decides the layout, who flies, and the rare moments; the kit does the
 * flight, the painting and the clock.
 */
import type { Composition, CompositionFactory, SceneConfig } from "../scene/composition";
import {
  drawDust,
  drawStars,
  paintRays,
  paintWisp,
  scatterMotes,
  type Mote,
  type Weather,
} from "../scene/atmosphere";
import { featherOf, type Feather } from "../scene/feather";
import { newFlier, type Flier } from "../scene/flier";
import { respawn, stepFliers, type Air } from "../scene/flock";
import { paintGlow, type GlowSpec } from "../scene/glow";
import { damp } from "../scene/math";
import { rareMoments, type Moments } from "../scene/moments";
import { paintFlier, type Lit } from "../scene/paint-flier";
import type { Reactions } from "../scene/reactions";
import { seededRng, type Rng } from "../scene/rng";

/** Fliers at each strength, before quality scales them. */
const FLOCK = { subtle: 4, soft: 6, vivid: 9 } as const;
const MOTES = { subtle: 14, soft: 22, vivid: 30 } as const;
const WISP_WIDTH = 380;
const WISP_HEIGHT = 64;
/** Depths the flock is spread over: three layers, nearest to farthest. */
const DEPTHS = [0.08, 0.5, 0.88] as const;

interface World {
  readonly config: SceneConfig;
  readonly glow: GlowSpec;
  readonly feather: Feather;
  readonly glowSprite: HTMLCanvasElement;
  readonly rays: HTMLCanvasElement | null;
  readonly wisps: readonly HTMLCanvasElement[];
  readonly motes: Mote[];
  readonly fliers: Flier[];
}

/** Where the flock is drawn toward: eased toward a goal that a navigation moves. */
interface Drift {
  x: number;
  y: number;
  goalX: number;
  goalY: number;
  sawNavigate: number;
}

interface Sky {
  readonly rng: Rng;
  readonly moments: Moments;
  readonly drift: Drift;
  world: World | null;
  time: number;
}

function skyLayout(config: SceneConfig): GlowSpec {
  const { width, height, direction, palette } = config;
  const scale = Math.min(1, width / 800);
  return {
    x: width * 0.63,
    y: height * (direction === "down" ? 0.34 : 0.66),
    reach: Math.min(width * 0.52, height * 1.25),
    disc: (palette.dark ? 34 : 38) * scale,
    squash: 1,
    power: palette.dark ? 4.2 : 3,
    intensity: palette.dark ? 1 : 1.4,
    washFrom: direction === "down" ? "top" : "bottom",
  };
}

function flockSize(config: SceneConfig): number {
  return Math.max(3, Math.round(FLOCK[config.strength] * config.quality));
}

function spawnFlock(rng: Rng, config: SceneConfig, glow: GlowSpec, count: number): Flier[] {
  const species = config.palette.dark ? "bat" : "swallow";
  return Array.from({ length: count }, (_, i) => {
    const depth = (DEPTHS[i % DEPTHS.length] ?? 0.5) + rng.range(-0.06, 0.06);
    return newFlier(rng, i, species, depth, {
      x: glow.x + rng.gauss() * config.width * 0.3,
      y: glow.y + rng.gauss() * config.height * 0.2,
    });
  });
}

/** The fliers for `config`: those alive stay alive when only the detail changes. */
function fliersFor(rng: Rng, config: SceneConfig, glow: GlowSpec, before: World | null): Flier[] {
  const count = flockSize(config);
  if (before === null || before.config.palette.dark !== config.palette.dark) {
    return spawnFlock(rng, config, glow, count);
  }
  const kept = before.fliers.slice(0, count);
  const more = spawnFlock(rng, config, glow, count);
  return kept.concat(more.slice(kept.length));
}

function buildWorld(rng: Rng, config: SceneConfig, before: World | null): World {
  const glow = skyLayout(config);
  const feather = featherOf(config.width, config.height, config.direction, config.presence);
  const { palette, dpr } = config;
  return {
    config,
    glow,
    feather,
    glowSprite: paintGlow(glow, palette, config, feather, rng),
    rays: palette.dark ? null : paintRays(palette, glow.reach * 2.2, dpr),
    wisps: [
      paintWisp(rng, palette.body, WISP_WIDTH, WISP_HEIGHT, dpr),
      paintWisp(rng, palette.body, WISP_WIDTH * 0.62, WISP_HEIGHT * 0.7, dpr),
    ],
    motes: scatterMotes(
      rng,
      Math.round(MOTES[config.strength] * config.quality),
      config.width,
      config.height,
      { x: glow.x, y: glow.y, r: glow.reach * 0.3 },
    ),
    fliers: fliersFor(rng, config, glow, before),
  };
}

function airOf(sky: Sky, world: World): Air {
  const { width, height } = world.config;
  return {
    arena: { width, height },
    time: sky.time,
    anchor: {
      x: world.glow.x + Math.sin(sky.time * 0.05) * width * 0.1 + sky.drift.x,
      y: world.glow.y + Math.cos(sky.time * 0.037) * height * 0.07 + sky.drift.y,
      radius: Math.min(width * 0.33, height * 0.9),
    },
  };
}

/** A rare moment: two chase, or a straggler hurries in to catch up. */
function startMoment(sky: Sky, world: World): void {
  const { rng, time } = sky;
  const free = world.fliers.filter((f) => !f.leaving && f.task.kind === "free" && f.depth < 0.7);
  const quarry = free[rng.int(0, free.length - 1)];
  if (quarry === undefined || free.length < 2) return;
  if (rng.chance(0.6)) {
    const rest = free.filter((f) => f !== quarry);
    const chaser = rest[rng.int(0, rest.length - 1)];
    if (chaser === undefined) return;
    const until = time + rng.range(6, 9);
    chaser.task = { kind: "chase", target: quarry.id, until };
    quarry.task = { kind: "evade", until };
    return;
  }
  const fresh = respawn(rng, quarry, airOf(sky, world));
  fresh.task = { kind: "join", until: time + rng.range(8, 11) };
  world.fliers[world.fliers.indexOf(quarry)] = fresh;
}

/** A navigation moves where the flock gathers; the drift eases there. */
function driftTo(sky: Sky, world: World, reactions: Reactions, dt: number): void {
  const { drift, rng } = sky;
  const since = reactions.sinceNavigate();
  if (since < drift.sawNavigate && since < 0.05) {
    drift.goalX = rng.range(-0.18, 0.18) * world.config.width;
    drift.goalY = rng.range(-0.12, 0.12) * world.config.height;
  }
  drift.sawNavigate = since;
  drift.x = damp(drift.x, drift.goalX, 0.7, dt);
  drift.y = damp(drift.y, drift.goalY, 0.7, dt);
}

/** Two wisps of cloud, crossing the light at their own slow paces, tilted and drifting as they go. */
function drawWisps(ctx: CanvasRenderingContext2D, world: World, time: number): void {
  const { config, glow } = world;
  const lanes = [
    { speed: 6, offset: 0.3, y: glow.y + 6, tilt: -0.09, scale: 1, alpha: 0.5 },
    { speed: 3.6, offset: 0.78, y: glow.y + 44, tilt: 0.05, scale: 0.7, alpha: 0.35 },
  ];
  lanes.forEach((lane, i) => {
    const sprite = world.wisps[i];
    if (sprite === undefined) return;
    const run = config.width + WISP_WIDTH * 2;
    const x = ((time * lane.speed + lane.offset * run) % run) - WISP_WIDTH * 1.2;
    const cx = x + (WISP_WIDTH * lane.scale) / 2;
    const cy = lane.y + Math.sin(time * 0.05 + i) * 6;
    ctx.setTransform(config.dpr, 0, 0, config.dpr, cx * config.dpr, cy * config.dpr);
    ctx.rotate(lane.tilt);
    ctx.globalAlpha = lane.alpha * world.feather.at(cx, cy);
    ctx.drawImage(
      sprite,
      (-WISP_WIDTH * lane.scale) / 2,
      (-WISP_HEIGHT * lane.scale) / 2,
      WISP_WIDTH * lane.scale,
      WISP_HEIGHT * lane.scale,
    );
  });
  ctx.globalAlpha = 1;
}

function drawLight(ctx: CanvasRenderingContext2D, world: World, time: number): void {
  const { glow, config } = world;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // The sprite is opaque and the page's own tone at its edge: drawn whole, never faded, or it would differ from the page.
  ctx.globalAlpha = 1;
  ctx.drawImage(world.glowSprite, 0, 0);
  if (world.rays !== null) {
    const size = glow.reach * 2.2;
    ctx.setTransform(config.dpr, 0, 0, config.dpr, glow.x * config.dpr, glow.y * config.dpr);
    ctx.rotate(time * 0.012);
    ctx.globalAlpha = 0.8 + 0.2 * Math.sin(time * 0.5);
    ctx.drawImage(world.rays, -size / 2, -size / 2, size, size);
  }
  ctx.globalAlpha = 1;
}

function drawSky(ctx: CanvasRenderingContext2D, world: World, time: number): void {
  const { config, glow, feather } = world;
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
  drawWisps(ctx, world, time);
  const lit: Lit = { palette, glow, feather, dpr };
  for (const flier of world.fliers.toSorted((a, b) => b.depth - a.depth)) {
    paintFlier(ctx, flier, lit);
  }
}

export const createSky: CompositionFactory = (seed): Composition => {
  const rng = seededRng(seed);
  const sky: Sky = {
    rng,
    moments: rareMoments(rng, 38, 18, rng.range(10, 24)),
    drift: { x: 0, y: 0, goalX: 0, goalY: 0, sawNavigate: Infinity },
    world: null,
    time: 0,
  };

  const step = (dt: number, reactions: Reactions) => {
    const { world } = sky;
    if (world === null) return;
    sky.time += dt;
    driftTo(sky, world, reactions, dt);
    if (sky.moments.due(sky.time)) startMoment(sky, world);
    stepFliers(world.fliers, airOf(sky, world), dt, reactions, rng);
  };

  return {
    configure: (config) => {
      sky.world = buildWorld(rng, config, sky.world);
    },
    step,
    draw: (ctx) => {
      if (sky.world !== null) drawSky(ctx, sky.world, sky.time);
    },
    settle: (reactions) => {
      for (let i = 0; i < 240; i++) step(1 / 30, reactions);
    },
  };
};
