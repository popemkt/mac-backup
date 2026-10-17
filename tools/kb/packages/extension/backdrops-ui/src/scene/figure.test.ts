import { describe, expect, it } from "vitest";
import { batFigure } from "./bat";
import { swallowFigure } from "./swallow";
import { BAT_GAIT, SWALLOW_GAIT, cycleAt, wingState } from "./gait";
import { toScreen } from "./draw-figure";
import { wound, type Figure, type Poly } from "./figure";

function area(poly: Poly): number {
  let total = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    total +=
      (poly[i * 2] ?? 0) * (poly[j * 2 + 1] ?? 0) - (poly[j * 2] ?? 0) * (poly[i * 2 + 1] ?? 0);
  }
  return total;
}

function everything(figure: Figure): Poly[] {
  return [...figure.membranes, ...figure.solids, ...figure.struts];
}

const tipY = (flap: number) => {
  const bat = batFigure(wingState(BAT_GAIT, { flap, velocity: 0 }, 0), 0);
  const nearWing = bat.membranes[1] ?? [];
  let top = Infinity;
  for (let i = 1; i < nearWing.length; i += 2) top = Math.min(top, nearWing[i] ?? 0);
  return top;
};

describe("figures", () => {
  const phases = Array.from({ length: 24 }, (_, i) => i / 24);

  it("every point of every beat is finite, for both species and any glide", () => {
    for (const phase of phases) {
      for (const glide of [0, 0.5, 1]) {
        const bat = batFigure(wingState(BAT_GAIT, cycleAt(phase), glide), 0.4);
        const swallow = swallowFigure(wingState(SWALLOW_GAIT, cycleAt(phase), glide), 0.5, 0.2);
        for (const poly of [...everything(bat), ...everything(swallow)]) {
          expect(poly.every(Number.isFinite)).toBe(true);
        }
      }
    }
  });

  it("closed shapes all wind one way, so overlapping parts union rather than cancel", () => {
    for (const phase of phases) {
      const bat = batFigure(wingState(BAT_GAIT, cycleAt(phase), 0), 0);
      for (const poly of [...bat.membranes, ...bat.solids])
        expect(area(poly)).toBeGreaterThanOrEqual(0);
    }
    expect(area(wound([0, 0, 0, 1, 1, 1, 1, 0]))).toBeGreaterThan(0);
  });

  it("a bat has two wings with four fingers each, ears, and eyes", () => {
    const bat = batFigure(wingState(BAT_GAIT, cycleAt(0.3), 0), 0);
    expect(bat.membranes).toHaveLength(2);
    expect(bat.struts).toHaveLength(2 * 5);
    expect(bat.eyes.length).toBeGreaterThanOrEqual(1);
  });

  it("the wing's tip rises on the up-stroke and falls on the down-stroke", () => {
    expect(tipY(1)).toBeLessThan(tipY(-1));
  });

  it("a swallow's tail is forked: its two streamers are far apart at the tips", () => {
    const swallow = swallowFigure(wingState(SWALLOW_GAIT, cycleAt(0), 1), 1, 0);
    const tail = swallow.solids[3] ?? [];
    const ys: number[] = [];
    for (let i = 1; i < tail.length; i += 2) ys.push(tail[i] ?? 0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.3);
  });
});

describe("placement", () => {
  const at = { x: 100, y: 100, size: 50, squash: 1 };

  it("a positive tilt lifts the nose, facing either way", () => {
    for (const mirror of [1, -1] as const) {
      const nose = toScreen({ ...at, tilt: 0.5, mirror }, 1, 0);
      expect(nose.y).toBeLessThan(100);
      expect(Math.sign(nose.x - 100)).toBe(mirror);
    }
  });

  it("hanging straight down puts the nose below and the tail above", () => {
    const nose = toScreen({ ...at, tilt: -Math.PI / 2, mirror: 1 }, 1, 0);
    const tail = toScreen({ ...at, tilt: -Math.PI / 2, mirror: 1 }, -1, 0);
    expect(nose.y).toBeGreaterThan(140);
    expect(tail.y).toBeLessThan(60);
  });
});
