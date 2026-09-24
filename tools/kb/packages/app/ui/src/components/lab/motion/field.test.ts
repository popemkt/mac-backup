import { describe, expect, it } from "vitest";
import { TIMING_FALLBACK } from "@/lib/timing";
import { TileField } from "./field";

const settle = TIMING_FALLBACK.follow;

function field(stagger = 0) {
  return new TileField(9, 0.5, settle, stagger, TIMING_FALLBACK.settle);
}

function run(f: TileField, seconds: number, x = 0, z = 0) {
  for (let i = 0; i < Math.round(seconds * 60); i++) f.step(1 / 60, x, z, 1);
}

describe("TileField", () => {
  const centre = 40; // the middle tile of a 9×9 field

  it("lifts the tile under the pointer to full height within the settle time (M5)", () => {
    const f = field();
    run(f, settle);
    expect(f.lift[centre]).toBeGreaterThan(0.95);
    expect(f.lift[0]).toBeLessThan(0.1);
  });

  it("eases to the same place in the same time, from rest", () => {
    const f = field();
    f.drive = "ease";
    run(f, settle + 1 / 60);
    expect(f.lift[centre]).toBeCloseTo(1, 2);
  });

  it("lets the glow trail the lift when overlap is on (M3)", () => {
    const f = field();
    run(f, 0.15);
    expect(f.glow[centre] ?? 0).toBeLessThan(f.lift[centre] ?? 0);
  });

  it("staggers a wave outward: a far tile starts later than a near one", () => {
    const early = field(0);
    const late = field(0.05);
    run(early, 0.12, -2, -2);
    run(late, 0.12, -2, -2);
    // Tile 0 sits at the pointer; tile 80 is the far corner.
    expect(late.lift[80] ?? 0).toBeLessThan(early.lift[80] ?? 0);
  });
});
