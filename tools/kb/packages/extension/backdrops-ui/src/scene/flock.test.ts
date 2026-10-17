import { describe, expect, it } from "vitest";
import { newFlier, type Flier } from "./flier";
import { stepFliers, type Air } from "./flock";
import { startReactions } from "./reactions";
import { seededRng } from "./rng";

const AIR: Air = {
  arena: { width: 1000, height: 360 },
  anchor: { x: 600, y: 120, radius: 200 },
  time: 0,
};

function flock(seed: number): { fliers: Flier[]; rng: ReturnType<typeof seededRng> } {
  const rng = seededRng(seed);
  const fliers = Array.from({ length: 10 }, (_, i) =>
    newFlier(rng, i, "bat", (i % 3) * 0.4, {
      x: 600 + rng.gauss() * 100,
      y: 120 + rng.gauss() * 50,
    }),
  );
  return { fliers, rng };
}

function simulate(
  seconds: number,
  dt: number,
  seed = 1,
  tune?: (r: ReturnType<typeof startReactions>) => void,
  sample?: (fliers: Flier[]) => void,
) {
  const { fliers, rng } = flock(seed);
  const reactions = startReactions();
  tune?.(reactions);
  let next = seconds / 2;
  for (let t = 0; t < seconds; t += dt) {
    reactions.update(dt);
    stepFliers(fliers, { ...AIR, time: t }, dt, reactions, rng);
    if (sample !== undefined && t >= next) {
      sample(fliers);
      next += 0.5;
    }
  }
  return fliers;
}

const meanSpeed = (fliers: Flier[]) =>
  fliers.reduce((sum, f) => sum + Math.hypot(f.vx, f.vy), 0) / fliers.length;

/** The pace over the second half of a run, sampled every half second. */
function pace(seconds: number, dt: number, tune?: (r: ReturnType<typeof startReactions>) => void) {
  const seen: number[] = [];
  simulate(seconds, dt, 1, tune, (fliers) => seen.push(meanSpeed(fliers)));
  return seen.reduce((a, b) => a + b, 0) / seen.length;
}

describe("flight", () => {
  it("is reproducible from a seed", () => {
    const a = simulate(20, 1 / 60, 4).map((f) => [f.x, f.y]);
    const b = simulate(20, 1 / 60, 4).map((f) => [f.x, f.y]);
    expect(a).toEqual(b);
  });

  it("keeps the flock in the frame for minutes, and every flier moving", () => {
    for (const f of simulate(180, 1 / 60)) {
      expect(f.x).toBeGreaterThan(-120);
      expect(f.x).toBeLessThan(1120);
      expect(f.y).toBeGreaterThan(-120);
      expect(f.y).toBeLessThan(480);
      expect(Math.hypot(f.vx, f.vy)).toBeGreaterThan(5);
    }
  });

  it("flies at the same pace at 60 and 120 Hz", () => {
    const slow = pace(60, 1 / 60);
    const fast = pace(60, 1 / 120);
    expect(Math.abs(slow - fast) / slow).toBeLessThan(0.25);
  });

  it("settles when the owner types, and quickens with a stir", () => {
    const normal = pace(40, 1 / 60);
    const calm = pace(40, 1 / 60, (r) => {
      r.setEditing(true);
    });
    expect(calm).toBeLessThan(normal * 0.9);
  });

  it("scatters from the pointer, then regathers", () => {
    const { fliers, rng } = flock(2);
    const reactions = startReactions();
    const target = fliers[0];
    if (target === undefined) throw new Error("no flier");
    target.x = 500;
    target.y = 180;
    target.vx = 0;
    target.vy = 0;
    reactions.setPointer(470, 180);
    let nearest = Infinity;
    for (let t = 0; t < 1.5; t += 1 / 60) {
      reactions.update(1 / 60);
      stepFliers(fliers, { ...AIR, time: t }, 1 / 60, reactions, rng);
      nearest = Math.min(nearest, Math.hypot(target.x - 470, target.y - 180));
    }
    expect(Math.hypot(target.x - 470, target.y - 180)).toBeGreaterThan(40);
    expect(nearest).toBeGreaterThan(20);
  });

  it("turns through the viewer rather than flipping", () => {
    const { fliers, rng } = flock(5);
    const reactions = startReactions();
    const f = fliers[0];
    if (f === undefined) throw new Error("no flier");
    f.turn = 1;
    f.vx = -200;
    f.vy = 0;
    const seen: number[] = [];
    for (let t = 0; t < 1; t += 1 / 60) {
      f.vx = -200;
      stepFliers([f], AIR, 1 / 60, reactions, rng);
      seen.push(f.turn);
    }
    expect(seen.some((v) => Math.abs(v) < 0.3)).toBe(true);
    for (let i = 1; i < seen.length; i++)
      expect(Math.abs((seen[i] ?? 0) - (seen[i - 1] ?? 0))).toBeLessThan(0.2);
  });
});

describe("tasks", () => {
  it("a perching flier slows as it nears its place and arrives rather than passes", () => {
    const { fliers, rng } = flock(11);
    const f = fliers[0];
    if (f === undefined) throw new Error("no flier");
    f.x = 200;
    f.y = 200;
    f.vx = 0;
    f.vy = 0;
    const reactions = startReactions();
    f.task = { kind: "perch", x: 420, y: 150, until: 99 };
    let closest = Infinity;
    let slowest = Infinity;
    for (let t = 0; t < 12; t += 1 / 60) {
      reactions.update(1 / 60);
      stepFliers([f], { ...AIR, time: t }, 1 / 60, reactions, rng);
      const d = Math.hypot(f.x - 420, f.y - 150);
      if (d < closest) {
        closest = d;
        slowest = Math.hypot(f.vx, f.vy);
      }
    }
    expect(closest).toBeLessThan(20);
    expect(slowest).toBeLessThan(f.cruise * 1.1);
  });

  it("a crossing flier goes straight across the frame and out, whatever the walls", () => {
    const { fliers, rng } = flock(12);
    const f = fliers[0];
    if (f === undefined) throw new Error("no flier");
    f.x = -50;
    f.y = 150;
    f.vx = f.cruise * 2;
    f.vy = 0;
    f.task = { kind: "cross", dir: 1, until: 99 };
    const reactions = startReactions();
    for (let t = 0; t < 12 && f.x < 1100; t += 1 / 60) {
      reactions.update(1 / 60);
      stepFliers([f], { ...AIR, time: t }, 1 / 60, reactions, rng);
      expect(f.vx).toBeGreaterThan(0);
    }
    expect(f.x).toBeGreaterThan(1000);
  });
});
