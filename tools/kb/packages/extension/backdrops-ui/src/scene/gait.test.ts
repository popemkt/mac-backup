import { describe, expect, it } from "vitest";
import { BAT_GAIT, SWALLOW_GAIT, blendWing, cycleAt, hangState, wingState } from "./gait";

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

describe("hanging", () => {
  it("wraps the wings forward round the body, tighter the more it wraps", () => {
    const loose = hangState(0, 0);
    const tight = hangState(1, 0);
    expect(tight.sweep).toBeLessThan(loose.sweep);
    expect(tight.spread).toBeLessThan(loose.spread);
    expect(tight.beat).toBeLessThan(loose.beat);
  });

  it("a stretch lifts the wing out of its wrap and back, continuously", () => {
    const rest = hangState(1, 0);
    const out = hangState(1, 1);
    expect(out.beat).toBeGreaterThan(rest.beat + 1);
    let last = hangState(1, 0).beat;
    for (let s = 0.05; s <= 1.0001; s += 0.05) {
      const now = hangState(1, s).beat;
      expect(now).toBeGreaterThan(last);
      last = now;
    }
  });

  it("letting go is a blend of one wing: the ends are the two poses, the middle between", () => {
    const fly = wingState(BAT_GAIT, cycleAt(0.3), 0);
    const hang = hangState(1, 0);
    expect(blendWing(fly, hang, 0)).toEqual(fly);
    const end = blendWing(fly, hang, 1);
    expect(end.beat).toBeCloseTo(hang.beat, 9);
    expect(end.sweep).toBeCloseTo(hang.sweep, 9);
    expect(end.spread).toBeCloseTo(hang.spread, 9);
    const half = blendWing(fly, hang, 0.5);
    expect(half.beat).toBeCloseTo((fly.beat + hang.beat) / 2, 9);
  });
});
