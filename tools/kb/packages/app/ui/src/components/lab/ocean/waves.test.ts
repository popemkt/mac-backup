import { describe, expect, it } from "vitest";
import { SHORTEST_WAVE, SEA_CELL, WAVE_COUNT, waveSet } from "./waves";

describe("the Gerstner wave set", () => {
  it("never folds a crest: steepness sums to at most 1, whatever the slider asks", () => {
    for (const height of [0, 0.3, 1, 4]) {
      const total = waveSet(height, 12, 0.3).reduce((sum, w) => sum + w.steepness, 0);
      expect(total).toBeLessThanOrEqual(1 + 1e-9);
      expect(total).toBeCloseTo(Math.min(1, height), 9);
    }
  });

  it("never draws a wave shorter than five grid cells, whatever the wavelength slider", () => {
    expect(SHORTEST_WAVE).toBeGreaterThanOrEqual(SEA_CELL * 5);
    for (let wavelength = 1; wavelength <= 40; wavelength += 0.5) {
      for (const w of waveSet(0.6, wavelength, 0.2)) {
        expect((Math.PI * 2) / w.k).toBeGreaterThanOrEqual(SEA_CELL * 5 - 1e-9);
      }
    }
  });

  it("travels at the deep-water speed, long waves faster, with unit directions", () => {
    const waves = waveSet(0.6, 16, -0.2);
    expect(waves).toHaveLength(WAVE_COUNT);
    for (const w of waves) {
      expect(Math.hypot(w.dx, w.dz)).toBeCloseTo(1, 9);
      expect(w.speed).toBeCloseTo(Math.sqrt(9.81 / w.k), 9);
      expect(w.amplitude * w.k).toBeCloseTo(w.steepness, 9);
    }
    for (let i = 1; i < waves.length; i++) {
      expect(waves[i]?.speed ?? 0).toBeLessThan(waves[i - 1]?.speed ?? 0);
    }
  });
});
