import { describe, expect, it } from "vitest";
import { TIMING_FALLBACK } from "@/lib/timing";
import { ENTRANCE_SPREAD, Entrance } from "@/components/lab/kit/entrance";
import { LAMP_ORDER, lampLevels } from "./lamps";

/** An entrance stepped to `progress` (0–1) of the arrive duration. */
function at(progress: number): Entrance {
  const entrance = new Entrance(TIMING_FALLBACK);
  entrance.step(TIMING_FALLBACK.arrive * progress, false);
  return entrance;
}

/** Where in the entrance a lamp at `lag` in the order starts to rise. */
function cue(lag: number): number {
  return lag * ENTRANCE_SPREAD;
}

describe("the Light study's lamps coming up", () => {
  it("waits the fill and rim until their cue, the key already rising", () => {
    const beforeFill = lampLevels(at(cue(LAMP_ORDER.fill) - 0.01));
    expect(beforeFill.key).toBeGreaterThan(0);
    expect(beforeFill.fill).toBeCloseTo(0.15, 9);
    expect(beforeFill.rim).toBe(0);
    const beforeRim = lampLevels(at(cue(LAMP_ORDER.rim) - 0.01));
    expect(beforeRim.fill).toBeGreaterThan(0.15);
    expect(beforeRim.rim).toBe(0);
  });

  it("brings each up after its cue, behind the key", () => {
    const afterFill = lampLevels(at(cue(LAMP_ORDER.fill) + 0.05));
    expect(afterFill.fill).toBeGreaterThan(0.15);
    const afterRim = lampLevels(at(cue(LAMP_ORDER.rim) + 0.05));
    expect(afterRim.rim).toBeGreaterThan(0);
    expect(afterRim.rim).toBeLessThan(afterRim.key);
  });

  it("starts the fill about a quarter in and the rim just under half", () => {
    expect(cue(LAMP_ORDER.fill)).toBeCloseTo(0.2475, 9);
    expect(cue(LAMP_ORDER.rim)).toBeCloseTo(0.44, 9);
  });

  it("is fully up at the end", () => {
    expect(lampLevels(at(1))).toEqual({ key: 1, fill: 1, rim: 1 });
  });
});
