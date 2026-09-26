import { describe, expect, it } from "vitest";
import { GraphArrival, hopsFromHubs } from "./graph-arrival";
import { TIMING_FALLBACK } from "./timing";

/** A star round node 0, with a tail 1 → 5 → 6 → 7 → 8 → 9. */
const LINKS: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [1, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [8, 9],
];
const COUNT = 10;
const degree = (i: number) => LINKS.filter(([a, b]) => a === i || b === i).length;
const neighbours = (i: number) => LINKS.flatMap(([a, b]) => (a === i ? [b] : b === i ? [a] : []));

describe("graph arrival", () => {
  it("counts hops outward from the best-connected node, capped", () => {
    const hops = [...hopsFromHubs(COUNT, degree, neighbours)];
    expect(hops[0]).toBe(0);
    expect(hops[2]).toBe(1);
    expect(hops[5]).toBe(2);
    expect(hops[6]).toBe(3);
    // Past the stagger's reach every node arrives together.
    expect(hops[8]).toBe(hops[9]);
  });

  it("brings the hub in before its neighbours, and settles within 300–400ms", () => {
    const arrival = new GraphArrival(TIMING_FALLBACK);
    arrival.start(hopsFromHubs(COUNT, degree, neighbours), true);
    expect(arrival.duration).toBeGreaterThanOrEqual(0.3);
    expect(arrival.duration).toBeLessThanOrEqual(0.4);
    arrival.step(0.08, false);
    expect(arrival.values[0] ?? 0).toBeGreaterThan(arrival.values[6] ?? 1);
    let t = 0.08;
    while (arrival.active && t < 1) {
      arrival.step(1 / 60, false);
      t += 1 / 60;
    }
    expect(arrival.active).toBe(false);
    expect(t).toBeLessThanOrEqual(arrival.duration + 1 / 60);
    expect([...arrival.values].every((v) => v === 1)).toBe(true);
  });

  it("is simply there under reduced motion, or when not animated", () => {
    const arrival = new GraphArrival(TIMING_FALLBACK);
    arrival.start(hopsFromHubs(COUNT, degree, neighbours), true);
    arrival.step(0.016, true);
    expect([...arrival.values].every((v) => v === 1)).toBe(true);
    arrival.start(hopsFromHubs(COUNT, degree, neighbours), false);
    expect(arrival.active).toBe(false);
    expect([...arrival.values].every((v) => v === 1)).toBe(true);
  });
});
