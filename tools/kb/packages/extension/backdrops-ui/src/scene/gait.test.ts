import { describe, expect, it } from "vitest";
import { BAT_GAIT, SWALLOW_GAIT, cycleAt, wingState } from "./gait";

describe("cycleAt", () => {
  it("is periodic and stays in range", () => {
    for (let p = -2; p < 3; p += 0.013) {
      const { flap, velocity } = cycleAt(p);
      expect(Math.abs(flap)).toBeLessThanOrEqual(1.0001);
      expect(Math.abs(velocity)).toBeLessThanOrEqual(1.5);
      expect(cycleAt(p + 1).flap).toBeCloseTo(flap, 9);
    }
  });
  it("is continuous: no step between neighbouring phases", () => {
    let last = cycleAt(0).flap;
    for (let p = 0.001; p < 1; p += 0.001) {
      const { flap } = cycleAt(p);
      expect(Math.abs(flap - last)).toBeLessThan(0.05);
      last = flap;
    }
  });
  it("beats down quicker than it recovers", () => {
    let down = 0;
    let up = 0;
    for (let p = 0; p < 1; p += 0.001) {
      if (cycleAt(p).velocity < 0) down++;
      else up++;
    }
    expect(down).toBeLessThan(up);
  });
});

describe("wingState", () => {
  it("lifts the wing from its down pose to its up pose across the beat", () => {
    const top = wingState(BAT_GAIT, { flap: 1, velocity: 0 }, 0);
    const bottom = wingState(BAT_GAIT, { flap: -1, velocity: 0 }, 0);
    expect(top.beat).toBeCloseTo(BAT_GAIT.up, 6);
    expect(bottom.beat).toBeCloseTo(BAT_GAIT.down, 6);
    expect(top.spread).toBeLessThan(bottom.spread);
  });
  it("settles into a glide continuously, with the wings held and swept", () => {
    let last = wingState(SWALLOW_GAIT, cycleAt(0.2), 0);
    for (let g = 0.05; g <= 1.0001; g += 0.05) {
      const now = wingState(SWALLOW_GAIT, cycleAt(0.2), g);
      expect(Math.abs(now.beat - last.beat)).toBeLessThan(0.3);
      last = now;
    }
    const glide = wingState(SWALLOW_GAIT, cycleAt(0.7), 1);
    expect(glide.beat).toBeCloseTo(SWALLOW_GAIT.glideBeat, 6);
    expect(glide.sweep).toBeCloseTo(SWALLOW_GAIT.sweepGlide, 6);
  });
});
