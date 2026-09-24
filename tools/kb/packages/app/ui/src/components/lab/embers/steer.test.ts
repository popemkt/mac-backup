import { describe, expect, it } from "vitest";
import { TIMING_FALLBACK } from "@/components/lab/kit/timing";
import { EmberSteer } from "./steer";

const FRAME = 1 / 60;

describe("EmberSteer", () => {
  it("reads no flick when the loop restarts after the pointer moved while stopped", () => {
    const steer = new EmberSteer(TIMING_FALLBACK);
    // Live, with the pointer drifting right.
    for (let i = 0; i < 30; i++) steer.frame(FRAME, i * FRAME, { x: i * 0.05, y: 0 });
    expect(steer.velocity.x).toBeGreaterThan(1);
    // The loop stops (hidden tab, reduced motion): no frames at all while the
    // pointer travels far. The stage's first frame after a restart is dt = 0.
    expect(steer.frame(0, 1, { x: -6, y: 4 })).toBe(false);
    // The first live frame after the restart samples nothing.
    expect(steer.frame(FRAME, 1 + FRAME, { x: -6, y: 4 })).toBe(true);
    expect(steer.velocity.x).toBe(0);
    expect(steer.velocity.y).toBe(0);
  });

  it("steps nothing on a zero step", () => {
    const steer = new EmberSteer(TIMING_FALLBACK);
    steer.frame(FRAME, 0, { x: 2, y: 1 });
    const { x, y } = steer.center;
    steer.frame(0, 0, { x: 5, y: 5 });
    expect(steer.center).toEqual({ x, y });
  });

  it("parks the pointer away while idle, so the ambient drift shoves nothing", () => {
    const steer = new EmberSteer(TIMING_FALLBACK);
    steer.frame(FRAME, 3, null);
    expect(steer.pointer.z).toBeGreaterThan(50);
    expect(steer.velocity.x).toBe(0);
  });

  it("follows a held aim to within 2% in the follow duration", () => {
    const steer = new EmberSteer(TIMING_FALLBACK);
    const frames = Math.round(TIMING_FALLBACK.follow / FRAME);
    for (let i = 0; i < frames; i++) steer.frame(FRAME, i * FRAME, { x: 1, y: 0 });
    expect(steer.center.x).toBeGreaterThan(0.97);
  });
});
