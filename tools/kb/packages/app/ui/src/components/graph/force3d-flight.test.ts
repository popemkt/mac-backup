import { describe, expect, it } from "vitest";
import { TIMING_FALLBACK } from "@/lib/timing";
import { CameraFlight, dollyGoal, fitGoal, neighbourhoodGoal, type Vec3 } from "./force3d-flight";

const FOLLOW = TIMING_FALLBACK.follow;
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function fly(flight: CameraFlight, seconds: number, fps = 60): number {
  let frames = 0;
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    frames++;
    if (!flight.step(1 / fps, false)) break;
  }
  return frames;
}

describe("CameraFlight (the 3D fly-to)", () => {
  it("moves on the next frame and lands on the goal, within about the follow time", () => {
    const flight = new CameraFlight(FOLLOW);
    flight.start(v(0, 0, 100), v(0, 0, 0), v(50, 0, 20), v(50, 0, 0));
    flight.step(1 / 60, false);
    expect(flight.eye.x).toBeGreaterThan(0);
    const frames = fly(flight, 3);
    expect(flight.active).toBe(false);
    expect(flight.eye).toEqual(v(50, 0, 20));
    expect(flight.look).toEqual(v(50, 0, 0));
    // Settled to 2% in `follow`; landed exactly a little after (M5).
    expect(frames / 60).toBeLessThan(FOLLOW * 2.5);
  });

  it("is critically damped: it never overshoots the goal", () => {
    const flight = new CameraFlight(FOLLOW);
    flight.start(v(0, 0, 0), v(0, 0, -1), v(100, 0, 0), v(100, 0, -1));
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      flight.step(1 / 60, false);
      peak = Math.max(peak, flight.eye.x);
    }
    expect(peak).toBeLessThanOrEqual(100 + 1e-9);
  });

  it("carries its velocity into a moved goal instead of restarting", () => {
    const flight = new CameraFlight(FOLLOW);
    flight.start(v(0, 0, 0), v(0, 0, -1), v(100, 0, 0), v(100, 0, -1));
    for (let i = 0; i < 6; i++) flight.step(1 / 60, false);
    const before = flight.eye.x;
    flight.start(v(-999, 0, 0), v(0, 0, 0), v(120, 0, 0), v(120, 0, -1));
    flight.step(1 / 60, false);
    // A flight under way is not re-seated at the (stale) camera position.
    expect(flight.eye.x).toBeGreaterThan(before);
  });

  it("cuts to the goal under reduced motion (M7), and stops when cancelled", () => {
    const flight = new CameraFlight(FOLLOW);
    flight.start(v(0, 0, 0), v(0, 0, -1), v(10, 20, 30), v(1, 2, 3));
    expect(flight.step(1 / 60, true)).toBe(false);
    expect(flight.eye).toEqual(v(10, 20, 30));
    flight.start(v(0, 0, 0), v(0, 0, -1), v(5, 5, 5), v(0, 0, 0));
    flight.cancel();
    expect(flight.step(1 / 60, false)).toBe(false);
  });
});

describe("flight goals", () => {
  it("fit frames every point from the current direction", () => {
    const positions = new Float32Array([-10, 0, 0, 10, 0, 0, 0, 10, 0, 0, -10, 0]);
    const out = { eye: v(0, 0, 0), look: v(0, 0, 0) };
    fitGoal(positions, 4, { fov: 50, aspect: 1.5, eye: v(0, 0, 500), look: v(0, 0, 0) }, 1, out);
    expect(out.look).toEqual(v(0, 0, 0));
    expect(out.eye.x).toBeCloseTo(0);
    expect(out.eye.z).toBeGreaterThan(20);
  });

  it("a fly-to frames the node's neighbourhood, from its size, not a fixed distance", () => {
    // Node 0 at the origin; a near neighbour and a far one.
    const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 200, 0]);
    const view = { fov: 50, aspect: 1.5, eye: v(0, 0, 500), look: v(0, 0, 0) };
    const frame = { radius: 4, padding: 1.25, nearest: 50 };
    const near = { eye: v(0, 0, 0), look: v(0, 0, 0) };
    const wide = { eye: v(0, 0, 0), look: v(0, 0, 0) };
    neighbourhoodGoal(positions, { node: 0, neighbours: [1] }, view, frame, near);
    neighbourhoodGoal(positions, { node: 0, neighbours: [1, 2] }, view, frame, wide);
    expect(near.look).toEqual(v(0, 0, 0));
    // A small neighbourhood never comes nearer than `nearest`…
    expect(near.eye.z).toBeCloseTo(50);
    // …a wide one backs off until the farthest neighbour fits with margin.
    const half = (50 * Math.PI) / 360;
    expect(wide.eye.z).toBeCloseTo((204 * 1.25) / Math.sin(half), 3);
    expect(wide.eye.x).toBeCloseTo(0);
  });

  it("dolly scales the distance to what the camera looks at", () => {
    const out = { eye: v(0, 0, 0), look: v(0, 0, 0) };
    dollyGoal({ eye: v(0, 0, 100), look: v(0, 0, 20) }, 0.5, out);
    expect(out.eye.z).toBe(60);
    expect(out.look.z).toBe(20);
  });
});
