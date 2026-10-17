import { describe, expect, it } from "vitest";
import { seededRng } from "../scene/rng";
import { startReactions } from "../scene/reactions";
import { stepFliers } from "../scene/flock";
import {
  advance,
  beatValue,
  hangPlace,
  letGo,
  nearness,
  shiverOf,
  spawnRoosters,
  type RoostWorld,
} from "./roosters";

const EAVE = 100;
const SLOTS = [100, 160, 230, 300];

function world(reactions = startReactions(), time = 0, dark = true): RoostWorld {
  return { time, eaveY: EAVE, dark, reactions, rng: seededRng(9), room: () => true };
}

describe("beatValue", () => {
  it("is a smooth pulse: nothing before and after, one peak in the middle", () => {
    const beat = { at: 10, length: 2 };
    expect(beatValue(beat, 9)).toBe(0);
    expect(beatValue(beat, 13)).toBe(0);
    expect(beatValue(beat, 11)).toBeCloseTo(1, 6);
    expect(beatValue(beat, 10.5)).toBeGreaterThan(0);
    expect(beatValue(beat, 10.5)).toBeLessThan(1);
  });
});

describe("roosters", () => {
  it("start asleep and hanging below the eave, by night some keeping a watch", () => {
    const night = spawnRoosters(seededRng(1), SLOTS, EAVE, 0, true);
    for (const r of night) {
      expect(r.mode).toBe("hang");
      expect(r.hold).toBe(1);
      expect(hangPlace(r, EAVE).y).toBeGreaterThan(EAVE);
    }
    const day = spawnRoosters(seededRng(1), SLOTS, EAVE, 0, false);
    expect(day.every((r) => r.restOpen === 0)).toBe(true);
    const many = spawnRoosters(
      seededRng(2),
      Array.from({ length: 60 }, (_, i) => i * 30),
      EAVE,
      0,
      true,
    );
    const watching = many.filter((r) => r.restOpen > 0).length;
    expect(watching).toBeGreaterThan(10);
    expect(watching).toBeLessThan(50);
  });

  it("feels the pointer when it is near, and not when it is far", () => {
    const [r] = spawnRoosters(seededRng(3), [200], EAVE, 0, true);
    if (r === undefined) throw new Error("no rooster");
    const at = hangPlace(r, EAVE);
    expect(nearness(r, EAVE, { x: at.x, y: at.y, near: 1 })).toBeCloseTo(1, 6);
    expect(nearness(r, EAVE, { x: at.x + 400, y: at.y, near: 1 })).toBe(0);
    expect(nearness(r, EAVE, { x: at.x, y: at.y, near: 0 })).toBe(0);
  });

  it("by day an eye only cracks near the pointer; by night it opens", () => {
    for (const dark of [true, false]) {
      const [r] = spawnRoosters(seededRng(4), [200], EAVE, 0, dark);
      if (r === undefined) throw new Error("no rooster");
      r.restOpen = 0;
      const reactions = startReactions();
      const at = hangPlace(r, EAVE);
      reactions.setPointer(at.x, at.y);
      for (let t = 0; t < 2; t += 1 / 60) {
        reactions.update(1 / 60);
        advance(r, 1 / 60, world(reactions, t, dark), EAVE);
      }
      if (dark) expect(r.open).toBeGreaterThan(0.9);
      else expect(r.open).toBeLessThan(0.6);
      expect(r.open).toBeGreaterThan(0.3);
    }
  });

  it("does nothing of its own while the owner types", () => {
    const rs = spawnRoosters(seededRng(5), SLOTS, EAVE, 0, true);
    const reactions = startReactions();
    reactions.setEditing(true);
    let time = 0;
    for (let t = 0; t < 40; t += 1 / 30) {
      time = t;
      reactions.update(1 / 30);
      for (const r of rs) advance(r, 1 / 30, world(reactions, time), EAVE);
    }
    for (const r of rs) {
      expect(r.mode).toBe("hang");
      expect(r.goalX).toBe(r.slotX);
    }
  });

  it("lets go, flies and comes back to the same perch, settling into the hang", () => {
    const [r] = spawnRoosters(seededRng(6), [260], EAVE, 0, true);
    if (r === undefined) throw new Error("no rooster");
    const rng = seededRng(7);
    const reactions = startReactions();
    const air = {
      arena: { width: 600, height: 300 },
      anchor: { x: 300, y: 140, radius: 120 },
      time: 0,
    };
    letGo(r, 0, 6, hangPlace(r, EAVE));
    const modes = new Set<string>();
    let time = 0;
    let lowestHold = 1;
    for (let t = 0; t < 40 && !(t > 8 && r.mode === "hang"); t += 1 / 60) {
      time = t;
      reactions.update(1 / 60);
      advance(r, 1 / 60, world(reactions, time), EAVE);
      if (r.mode === "drop" || r.mode === "out" || r.mode === "return") {
        stepFliers([r.flier], { ...air, time }, 1 / 60, reactions, rng);
      }
      modes.add(r.mode);
      lowestHold = Math.min(lowestHold, r.hold);
    }
    expect([...modes]).toEqual(expect.arrayContaining(["drop", "out", "return", "settle", "hang"]));
    expect(lowestHold).toBeLessThan(0.05);
    expect(r.hold).toBe(1);
    expect(r.mode).toBe("hang");
  });

  it("shivers as a small quick tremor that dies away", () => {
    const [r] = spawnRoosters(seededRng(8), [200], EAVE, 0, true);
    if (r === undefined) throw new Error("no rooster");
    r.shiver = { at: 5, length: 1.2 };
    let peak = 0;
    for (let t = 5; t < 6.2; t += 0.01) peak = Math.max(peak, Math.abs(shiverOf(r, t)));
    expect(peak).toBeGreaterThan(0.01);
    expect(peak).toBeLessThan(0.1);
    expect(shiverOf(r, 7)).toBe(0);
  });
});
