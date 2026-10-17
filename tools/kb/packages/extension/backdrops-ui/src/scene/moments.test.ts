import { describe, expect, it } from "vitest";
import { rareMoments } from "./moments";
import { seededRng } from "./rng";
import { featherOf } from "./feather";

describe("rareMoments", () => {
  it("fires once when due, then waits at least the cooldown, unpredictably", () => {
    const m = rareMoments(seededRng(3), 30, 15, 10);
    expect(m.due(5)).toBe(false);
    expect(m.due(10)).toBe(true);
    expect(m.due(10.01)).toBe(false);
    const gaps: number[] = [];
    let last = 10;
    for (let t = 10; t < 4000; t += 0.5) {
      if (m.due(t)) {
        gaps.push(t - last);
        last = t;
      }
    }
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(14.5);
    expect(new Set(gaps.map((g) => Math.round(g))).size).toBeGreaterThan(5);
  });
});

describe("featherOf", () => {
  it("is nothing at the edge, whole inside, and longer on the open side", () => {
    const down = featherOf(1000, 400, "down");
    const up = featherOf(1000, 400, "up");
    expect(down.at(0, 200)).toBe(0);
    expect(down.at(500, 200)).toBe(1);
    expect(down.at(500, 400)).toBe(0);
    expect(down.at(500, 330)).toBeLessThan(up.at(500, 330));
  });
});
