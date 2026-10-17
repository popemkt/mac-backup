/**
 * The bats of Roost: each hangs under the eave, asleep, wrapped in its wings,
 * and now and then stretches, shuffles along the beam or re-wraps; at night
 * some peel off, circle the house and come back. A rooster is a flier
 * (`../scene/flier`) with a perch: hanging is a pose of the same wing as
 * flying (`hangState`), blended by `hold`, so letting go and taking hold are
 * the one body at every point between, never a swap.
 */
import { newFlier, type Flier } from "../scene/flier";
import { damp, envelope, lerp } from "../scene/math";
import type { Reactions } from "../scene/reactions";
import type { Rng } from "../scene/rng";

type Mode = "hang" | "drop" | "out" | "return" | "settle";

/** A one-off beat of a rooster's rest, as a pulse from the time it began. */
interface Beat {
  at: number;
  /** Seconds it lasts. */
  length: number;
}

const NEVER: Beat = { at: -1e9, length: 1 };

export interface Rooster {
  readonly id: number;
  readonly flier: Flier;
  /** Where it hangs along the eave now, and where it is going (a shuffle). */
  slotX: number;
  goalX: number;
  mode: Mode;
  /** 1 hanging … 0 airborne. */
  hold: number;
  /** How tightly the wings are drawn round the body: 1 wrapped. */
  wrap: number;
  stretch: Beat;
  shiver: Beat;
  /** Eyes: how open they are, and how open this bat sleeps (some by night keep a watch). */
  open: number;
  restOpen: number;
  breath: number;
  nextEvent: number;
  /** When an outing ends; and when a ripple of the owner's navigation reaches this bat. */
  outUntil: number;
  rippleAt: number;
}

/** How far below the eave a hanging bat's centre sits, in body lengths. */
const HANG_DROP = 0.5;
/** How a hanging bat points: nose straight down (nose-up positive). */
export const HANG_TILT = -Math.PI / 2;

/** A pulse in [0, 1] that peaks mid-beat: smooth in and out, so nothing snaps. */
export function beatValue(beat: Beat, now: number): number {
  const u = (now - beat.at) / beat.length;
  return u < 0 || u > 1 ? 0 : Math.sin(Math.PI * u) ** 2;
}

/** The roosters for `slots` (x along the eave): varied in size, spacing, and the way they face. */
export function spawnRoosters(
  rng: Rng,
  slots: readonly number[],
  eaveY: number,
  now: number,
  dark: boolean,
): Rooster[] {
  return slots.map((x, id) => {
    const flier = newFlier(rng, id, "bat", 0.1, { x, y: eaveY });
    flier.life = 1e9;
    flier.size = rng.range(27, 41);
    flier.turn = rng.chance(0.5) ? 1 : -1;
    return {
      id,
      flier,
      slotX: x,
      goalX: x,
      mode: "hang",
      hold: 1,
      wrap: rng.range(0.85, 1),
      stretch: NEVER,
      shiver: NEVER,
      open: 0,
      restOpen: dark && rng.chance(0.45) ? 1 : 0,
      breath: rng.range(0, 6.28),
      nextEvent: now + rng.range(3, 16),
      outUntil: 0,
      rippleAt: -1,
    };
  });
}

/** Where a rooster hangs: below the eave, at its slot. */
export function hangPlace(r: Rooster, eaveY: number): { x: number; y: number } {
  return { x: r.slotX, y: eaveY + HANG_DROP * r.flier.size };
}

/** How close the pointer is to `r`, 0 far … 1 on it. */
export function nearness(
  r: Rooster,
  eaveY: number,
  pointer: { x: number; y: number; near: number },
): number {
  const at = hangPlace(r, eaveY);
  const d = Math.hypot(pointer.x - at.x, pointer.y - at.y);
  const reach = 70 + r.flier.size;
  return Math.max(0, 1 - d / reach) * pointer.near;
}

/** What the world offers a rooster this step. */
export interface RoostWorld {
  readonly time: number;
  readonly eaveY: number;
  readonly dark: boolean;
  readonly reactions: Reactions;
  readonly rng: Rng;
  /** The least a neighbour must be given along the beam, so shuffling bats never overlap. */
  readonly room: (r: Rooster, x: number) => boolean;
}

/** Start one of the small spontaneous things a hanging bat does. */
function startEvent(r: Rooster, world: RoostWorld): void {
  const { rng, time, dark } = world;
  const roll = rng.next();
  if (roll < 0.34) r.stretch = { at: time, length: rng.range(2.4, 3.6) };
  else if (roll < 0.6) {
    const step = rng.range(10, 26) * (rng.chance(0.5) ? 1 : -1);
    if (world.room(r, r.slotX + step)) r.goalX = r.slotX + step;
    r.shiver = { at: time, length: 0.9 };
  } else if (roll < 0.84 || !dark) r.shiver = { at: time, length: rng.range(1.6, 2.4) };
  else r.restOpen = r.restOpen > 0.5 ? 0 : 1;
}

/** A hanging rooster, one step: breathing, its own doings, and what the owner does near it. */
function hang(r: Rooster, dt: number, world: RoostWorld): void {
  const { time, reactions, dark, eaveY } = world;
  const calm = reactions.calm;
  r.breath += dt * (1.1 - 0.4 * calm) * (0.9 + 0.2 * Math.sin(r.id * 2.1));
  r.slotX = damp(r.slotX, r.goalX, 3.2, dt);
  // The owner near it: a shiver and, by night, an eye cracking open.
  const close = nearness(r, eaveY, reactions.pointer) * (1 - calm);
  if (close > 0.55 && beatValue(r.shiver, time) === 0) r.shiver = { at: time, length: 1.1 };
  if (time >= r.rippleAt && r.rippleAt > 0) {
    r.shiver = { at: time, length: 1.4 };
    r.rippleAt = -1;
  }
  // By day an eye only cracks; by night it opens fully.
  const wake = close > 0.3 ? (dark ? 1 : 0.55) : r.restOpen;
  r.open = damp(r.open, wake, close > 0.3 ? 5 : 1.1, dt);
  if (calm < 0.3 && time >= r.nextEvent) {
    startEvent(r, world);
    r.nextEvent = time + world.rng.range(dark ? 7 : 11, dark ? 20 : 30);
  } else if (time >= r.nextEvent) r.nextEvent = time + 3;
  const shivering = beatValue(r.shiver, time);
  r.wrap = damp(r.wrap, 0.95 - 0.3 * shivering, 4, dt);
}

/** Let go: gravity first, then the wings. */
export function letGo(r: Rooster, time: number, outFor: number, hangAt: { x: number; y: number }) {
  const { flier } = r;
  r.mode = "drop";
  r.outUntil = time + outFor;
  flier.x = hangAt.x;
  flier.y = hangAt.y;
  flier.vx = flier.turn * 30;
  flier.vy = 90;
  flier.phase = 0.6;
  flier.glideGoal = 0;
  flier.glide = 0.2;
}

/** The release and arrival: one rooster's hold on the eave, over time. */
export function advance(r: Rooster, dt: number, world: RoostWorld, eaveY: number): void {
  const { flier } = r;
  const { time } = world;
  if (r.mode === "hang") return hang(r, dt, world);
  if (r.mode === "drop") {
    r.hold = damp(r.hold, 0, 6, dt);
    if (r.hold < 0.06) {
      r.hold = 0;
      r.mode = "out";
    }
  } else if (r.mode === "out" && time >= r.outUntil) {
    r.mode = "return";
    const at = hangPlace(r, eaveY);
    flier.task = { kind: "perch", x: at.x, y: at.y, until: time + 40 };
  } else if (r.mode === "return") {
    const at = hangPlace(r, eaveY);
    if (Math.hypot(flier.x - at.x, flier.y - at.y) < 16) r.mode = "settle";
  } else if (r.mode === "settle") {
    r.hold = damp(r.hold, 1, 4.5, dt);
    if (r.hold > 0.985) {
      r.hold = 1;
      r.mode = "hang";
      flier.task = { kind: "free" };
    }
  }
  r.open = damp(r.open, world.dark ? 1 : 0.2, 3, dt);
  r.wrap = damp(r.wrap, lerp(0.2, 0.95, r.hold), 4, dt);
}

/** The stretch's value for display, a pulse over the stretch's length. */
export function stretchOf(r: Rooster, now: number): number {
  return beatValue(r.stretch, now);
}

/** The shiver as a small quick tremor in radians, fading out. */
export function shiverOf(r: Rooster, now: number): number {
  const u = beatValue(r.shiver, now);
  return u * Math.sin((now - r.shiver.at) * 22) * 0.07 * envelope(now - r.shiver.at, 0.05, 0.5);
}
