/**
 * Flight: a light flocking model (cohesion, separation, alignment, a wander
 * that is each flier's own) toward a slowly moving anchor the flock circles,
 * plus the owner's reactions. Everything is acceleration over `dt` seconds,
 * so it is smooth at any frame rate; nothing here is a per-frame step.
 */
import { clamp, damp, dampAngle, smoothstep, wrapAngle } from "./math.ts";
import type { Flier } from "./flier.ts";
import { depthScale, FREE, newFlier } from "./flier.ts";
import type { Reactions } from "./reactions.ts";
import type { Rng } from "./rng.ts";

interface Arena {
  readonly width: number;
  readonly height: number;
}

interface Anchor {
  readonly x: number;
  readonly y: number;
  /** How far from it the flock is happy to range, CSS pixels. */
  readonly radius: number;
}

/** What the scene says about the air right now. */
export interface Air {
  readonly arena: Arena;
  readonly anchor: Anchor;
  readonly time: number;
}

/** The margin outside the frame at which a leaving flier is gone and a new one enters. */
const GONE = 80;
const POINTER_RADIUS = 120;

interface Push {
  x: number;
  y: number;
}

const ZERO: Readonly<Push> = { x: 0, y: 0 };

/** How the owner's reactions change a flier's pace: calm slows, a stir and a ripple quicken. */
function paceOf(reactions: Reactions): number {
  return (1 - 0.45 * reactions.calm) * (1 + 0.3 * reactions.stir + 0.35 * reactions.ripple);
}

function neighbourPush(self: Flier, others: readonly Flier[], reach: number, gather: number): Push {
  let sepX = 0;
  let sepY = 0;
  let cohX = 0;
  let cohY = 0;
  let aliX = 0;
  let aliY = 0;
  let count = 0;
  for (const other of others) {
    if (other === self || Math.abs(other.depth - self.depth) > 0.3) continue;
    const dx = other.x - self.x;
    const dy = other.y - self.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > reach * 4) continue;
    if (d < reach) {
      const away = (reach - d) / reach;
      sepX -= (dx / d) * away;
      sepY -= (dy / d) * away;
    }
    cohX += dx;
    cohY += dy;
    aliX += other.vx;
    aliY += other.vy;
    count++;
  }
  if (count === 0) return ZERO;
  return {
    x: sepX * 420 + (cohX / count) * 0.05 * gather + (aliX / count - self.vx) * 0.45,
    y: sepY * 420 + (cohY / count) * 0.05 * gather + (aliY / count - self.vy) * 0.45,
  };
}

function pointerPush(self: Flier, reactions: Reactions): Push {
  const { x, y, near } = reactions.pointer;
  if (near < 0.01 || reactions.calm > 0.95) return ZERO;
  const dx = self.x - x;
  const dy = self.y - y;
  const d = Math.hypot(dx, dy) || 1;
  const radius = POINTER_RADIUS + self.size;
  if (d > radius) return ZERO;
  const away = (1 - d / radius) ** 2 * 620 * near * (1 - reactions.calm);
  return { x: (dx / d) * away, y: (dy / d) * away };
}

function edgePush(self: Flier, arena: Arena): Push {
  const m = 36 + self.size;
  const k = 90;
  const fx = smoothstep(m, 0, self.x) - smoothstep(arena.width - m, arena.width, self.x);
  const fy = smoothstep(m, 0, self.y) - smoothstep(arena.height - m, arena.height, self.y);
  return { x: fx * k * 3, y: fy * k * 3 };
}

/** Let a flier turn a little by its own noise: wandering with memory, never twitching. */
function wander(self: Flier, air: Air, dt: number, reactions: Reactions): void {
  const whim = 0.9 + 0.8 * reactions.stir;
  self.heading = wrapAngle(
    self.heading + self.noise(air.time * 0.16 + self.clock) * 1.3 * whim * dt,
  );
}

/** The velocity this flier would like: its own wandering, bent toward and around the anchor. */
function desiredVelocity(self: Flier, air: Air, pace: number, reactions: Reactions): Push {
  const t = air.time * 0.16 + self.clock;
  const scale = depthScale(self.depth);
  const speed = self.cruise * pace;
  const heading = self.heading;
  let wx = Math.cos(heading) * speed;
  let wy = Math.sin(heading) * speed * 0.55;
  const dx = air.anchor.x - self.x;
  const dy = air.anchor.y - self.y;
  const d = Math.hypot(dx, dy) || 1;
  const radius =
    air.anchor.radius * (0.7 + 0.6 * (1 - self.depth)) * (0.8 + 0.4 * self.noiseB(t * 0.4));
  const pull = smoothstep(radius * 0.55, radius * 1.7, d) + 0.35 * reactions.ripple;
  // Around the light as well as toward it: a loose ring, never a track.
  const toward = { x: dx / d, y: dy / d };
  const around = { x: -toward.y * self.swirl, y: toward.x * self.swirl * 0.7 };
  const bend = clamp(pull, 0, 1);
  wx = wx * (1 - bend) + (toward.x * 0.75 + around.x * 0.5) * speed * bend;
  wy = wy * (1 - bend) + (toward.y * 0.75 + around.y * 0.5) * speed * bend;
  const free = 0.35 * (1 - bend) * scale.speed;
  const out = { x: wx + around.x * speed * free, y: wy + around.y * speed * free * 0.5 };
  // Steering that cancels (the wander against the pull) must not stall a flier: a bat never hovers.
  const magnitude = Math.hypot(out.x, out.y);
  const least = speed * 0.7;
  if (magnitude >= least) return out;
  if (magnitude < 1e-6)
    return { x: Math.cos(heading) * least, y: Math.sin(heading) * least * 0.55 };
  return { x: (out.x / magnitude) * least, y: (out.y / magnitude) * least };
}

/** What a task asks of a flier: where it heads and how hard, in place of its own drifting. */
function taskVelocity(self: Flier, others: readonly Flier[], air: Air, pace: number): Push | null {
  const { task } = self;
  if (task.kind === "chase") {
    const prey = others.find((other) => other.id === task.target);
    if (prey === undefined) return null;
    const dx = prey.x + prey.vx * 0.35 - self.x;
    const dy = prey.y + prey.vy * 0.35 - self.y;
    const d = Math.hypot(dx, dy) || 1;
    const speed = Math.max(self.cruise, Math.hypot(prey.vx, prey.vy)) * 1.35 * pace;
    return { x: (dx / d) * speed, y: (dy / d) * speed };
  }
  if (task.kind === "join") {
    const dx = air.anchor.x - self.x;
    const dy = air.anchor.y - self.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: (dx / d) * self.cruise * 1.7 * pace, y: (dy / d) * self.cruise * 1.7 * pace };
  }
  if (task.kind === "perch") {
    const dx = task.x - self.x;
    const dy = task.y - self.y;
    const d = Math.hypot(dx, dy) || 1;
    // Slow as it nears, so it arrives rather than overshoots.
    const speed = Math.min(self.cruise * 1.3, 30 + d * 1.8) * pace;
    return { x: (dx / d) * speed, y: (dy / d) * speed };
  }
  if (task.kind === "cross") {
    return { x: task.dir * self.cruise * 2 * pace, y: Math.sin(air.time * 2.3 + self.clock) * 14 };
  }
  return null;
}

/** Advance one flier's flight by `dt`. */
function fly(self: Flier, others: readonly Flier[], air: Air, dt: number, reactions: Reactions) {
  const pace = paceOf(reactions) * (self.task.kind === "evade" ? 1.3 : 1);
  wander(self, air, dt, reactions);
  const want = self.leaving
    ? outward(self, air, pace)
    : (taskVelocity(self, others, air, pace) ?? desiredVelocity(self, air, pace, reactions));
  const near = neighbourPush(self, others, self.size * 3.4, 1 + 3.5 * reactions.ripple);
  const scare = pointerPush(self, reactions);
  const wall = self.leaving || self.task.kind === "cross" ? ZERO : edgePush(self, air.arena);
  const responsive = 1.5 - 0.5 * reactions.calm;
  self.vx += ((want.x - self.vx) * responsive + near.x + scare.x + wall.x) * dt;
  self.vy += ((want.y - self.vy) * responsive + near.y + scare.y + wall.y) * dt;
  const limit = self.cruise * 2.2 * Math.max(0.6, pace);
  const speed = Math.hypot(self.vx, self.vy);
  if (speed > limit) {
    self.vx *= limit / speed;
    self.vy *= limit / speed;
  }
  self.x += self.vx * dt;
  self.y += self.vy * dt;
}

/** Heading out of the frame, past the nearest edge. */
function outward(self: Flier, air: Air, pace: number): Push {
  const left = self.x;
  const right = air.arena.width - self.x;
  const up = self.y;
  const down = air.arena.height - self.y;
  const nearest = Math.min(left, right, up, down);
  const speed = self.cruise * pace * 1.25;
  if (nearest === left) return { x: -speed, y: self.vy * 0.3 };
  if (nearest === right) return { x: speed, y: self.vy * 0.3 };
  if (nearest === up) return { x: self.vx * 0.3, y: -speed };
  return { x: self.vx * 0.3, y: speed };
}

/** Wing beat, glide, turn, tilt and blink: how a flier looks, not where it goes. */
function animate(self: Flier, dt: number, reactions: Reactions, rng: Rng) {
  const rate = 1 + 0.35 * reactions.stir - 0.3 * reactions.calm + 0.15 * reactions.ripple;
  const gliding = self.glide > 0.5;
  self.phase += dt * self.beatHz * rate * (1 - 0.5 * self.glide) * (gliding ? 0.4 : 1);
  self.modeLeft -= dt;
  if (self.modeLeft <= 0) {
    const toGlide = self.glideGoal < 0.5 && rng.chance(0.55 + 0.35 * reactions.calm);
    self.glideGoal = toGlide ? 1 : 0;
    const bat = self.species === "bat";
    self.modeLeft = toGlide
      ? rng.range(bat ? 0.4 : 0.6, bat ? 1.1 : 1.6) * (1 + reactions.calm)
      : rng.range(bat ? 1.6 : 0.9, bat ? 4.5 : 2.4) * (1 - 0.4 * reactions.calm);
  }
  self.glide = damp(self.glide, self.glideGoal, 3.2, dt);
  const speed = Math.hypot(self.vx, self.vy);
  if (Math.abs(self.vx) > 0.15 * self.cruise) {
    self.turn = damp(self.turn, Math.sign(self.vx), 4.2, dt);
  }
  const climb = -Math.atan2(self.vy, Math.max(Math.abs(self.vx), 40));
  self.tilt = dampAngle(
    self.tilt,
    clamp(climb, -0.65, 0.65) * clamp(speed / self.cruise, 0.3, 1),
    5,
    dt,
  );
  self.blinkLeft -= dt;
  if (self.blinkLeft <= 0) {
    self.blink = 1;
    self.blinkLeft = rng.range(2.5, 8);
  }
  self.blink = damp(self.blink, 0, 14, dt);
}

/** A flier that has left the frame, replaced by a new one entering at an edge. */
export function respawn(rng: Rng, self: Flier, air: Air): Flier {
  const { width, height } = air.arena;
  const fromLeft = self.x > width / 2 ? rng.chance(0.7) : rng.chance(0.3);
  const y = rng.range(height * 0.2, height * 0.8);
  const x = fromLeft ? -GONE * 0.6 : width + GONE * 0.6;
  const fresh = newFlier(rng, self.id, self.species, self.depth, { x, y });
  const speed = fresh.cruise * 1.1;
  fresh.vx = fromLeft ? speed : -speed;
  fresh.vy = rng.range(-0.2, 0.2) * speed;
  fresh.turn = fromLeft ? 1 : -1;
  return fresh;
}

/** The outside of the frame, a leaving flier crossing it. */
function isGone(self: Flier, arena: Arena): boolean {
  return (
    self.x < -GONE || self.x > arena.width + GONE || self.y < -GONE || self.y > arena.height + GONE
  );
}

/** Advance every flier by `dt`; those that have finished their time leave and are replaced. */
export function stepFliers(
  fliers: Flier[],
  air: Air,
  dt: number,
  reactions: Reactions,
  rng: Rng,
): void {
  for (let i = 0; i < fliers.length; i++) {
    const self = fliers[i];
    if (self === undefined) continue;
    self.life -= dt;
    if (self.life <= 0) self.leaving = true;
    fly(self, fliers, air, dt, reactions);
    animate(self, dt, reactions, rng);
    if (self.leaving && isGone(self, air.arena)) fliers[i] = respawn(rng, self, air);
    if (self.task.kind !== "free" && self.task.until <= air.time) self.task = FREE;
  }
}
