import { describe, expect, it } from "vitest";
import { TIMING_FALLBACK, easeAt } from "@/lib/timing";
import { Entrance } from "./entrance";

describe("a study's entrance", () => {
  it("is over at once under reduced motion (M7)", () => {
    const entrance = new Entrance(TIMING_FALLBACK);
    entrance.step(0, true);
    expect(entrance.arrived(0)).toBe(1);
    expect(entrance.arrived(1)).toBe(1);
  });

  it("arrives on the settle ease over the arrive duration, later pieces behind (M6, M3)", () => {
    const entrance = new Entrance(TIMING_FALLBACK);
    expect(entrance.arrived(0)).toBe(0);
    entrance.step(TIMING_FALLBACK.arrive * 0.3, false);
    const first = entrance.arrived(0);
    const last = entrance.arrived(1);
    expect(first).toBeGreaterThan(last);
    expect(first).toBeCloseTo(easeAt(TIMING_FALLBACK.settle, 0.3 / 0.45), 9);
    entrance.step(TIMING_FALLBACK.arrive, false);
    expect(entrance.arrived(0)).toBe(1);
    expect(entrance.arrived(1)).toBe(1);
  });
});
