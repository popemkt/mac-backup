import { describe, expect, it } from "vitest";
import { SKY_PAN, panCoast, panDrag, panRelease, restingPan } from "./pan";

describe("pan with momentum", () => {
  it("follows a drag exactly, and caps the speed a flick can leave", () => {
    const pan = restingPan();
    panDrag(pan, SKY_PAN, -100, 0, 1 / 60);
    expect(pan.yaw).toBeCloseTo(100 * SKY_PAN.perPixel, 9);
    for (let i = 0; i < 20; i++) panDrag(pan, SKY_PAN, -400, 0, 1 / 240);
    expect(pan.yawSpeed).toBeLessThanOrEqual(1.6);
  });

  it("coasts after release and decays to rest", () => {
    const pan = restingPan();
    for (let i = 0; i < 6; i++) panDrag(pan, SKY_PAN, -20, 0, 1 / 60);
    const released = pan.yaw;
    panCoast(pan, SKY_PAN, 1 / 60, false);
    expect(pan.yaw).toBeGreaterThan(released);
    for (let i = 0; i < 240; i++) panCoast(pan, SKY_PAN, 1 / 60, false);
    expect(Math.abs(pan.yawSpeed)).toBeLessThan(0.01);
  });

  it("stops dead on a late release, and under reduced motion", () => {
    const pan = restingPan();
    panDrag(pan, SKY_PAN, -30, 0, 1 / 60);
    panRelease(pan, 0.5);
    expect(pan.yawSpeed).toBe(0);
    panDrag(pan, SKY_PAN, -30, 0, 1 / 60);
    const held = pan.yaw;
    panCoast(pan, SKY_PAN, 1 / 60, true);
    expect(pan.yaw).toBe(held);
  });

  it("holds pitch and a bounded yaw inside their limits", () => {
    const pan = restingPan();
    panDrag(pan, SKY_PAN, 0, 10_000, 1 / 60);
    expect(pan.pitch).toBe(SKY_PAN.pitchLimit);
    const bounded = { perPixel: 0.01, pitchLimit: 0, yawLimit: 0.5 };
    panDrag(pan, bounded, -10_000, 0, 1 / 60);
    expect(pan.yaw).toBe(0.5);
  });
});
