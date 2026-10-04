import { describe, expect, it } from "vitest";
import { PointerVelocity } from "./velocity";

describe("PointerVelocity", () => {
  it("reads nothing from the first live frame, wherever the pointer lands", () => {
    const v = new PointerVelocity();
    v.step(1 / 60, { x: 5, y: -3 });
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });

  it("never samples across an idle gap", () => {
    const v = new PointerVelocity();
    v.step(1 / 60, { x: 0, y: 0 });
    for (let i = 0; i < 120; i++) v.step(1 / 60, null);
    v.step(1 / 60, { x: 4, y: 4 });
    expect(Math.hypot(v.x, v.y)).toBeLessThan(1e-3);
  });

  it("forgets its estimate and its seed across a zero step (a loop restart)", () => {
    const v = new PointerVelocity();
    for (let i = 0; i <= 30; i++) v.step(1 / 60, { x: i / 60, y: 0 });
    v.step(0, { x: 9, y: 9 });
    expect(v.x).toBe(0);
    v.step(1 / 60, { x: 9, y: 9 });
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });

  it("follows a steady move and eases back to rest when idle", () => {
    const v = new PointerVelocity();
    for (let i = 0; i <= 60; i++) v.step(1 / 60, { x: i / 60, y: 0 });
    expect(v.x).toBeCloseTo(1, 2);
    for (let i = 0; i < 60; i++) v.step(1 / 60, null);
    expect(v.x).toBeLessThan(1e-3);
  });
});
