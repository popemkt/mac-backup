import { describe, expect, it } from "vitest";
import { orbitEye } from "./orbit";

describe("the orbit's eye", () => {
  const target = { x: 1, y: -2, z: 3 };

  it("stands in front of the target at rest, looking down -z", () => {
    const eye = { x: 0, y: 0, z: 0 };
    orbitEye(target, 0, 0, 5, eye);
    expect(eye).toEqual({ x: 1, y: -2, z: 8 });
  });

  it("keeps its distance from the target whatever the bearing", () => {
    const eye = { x: 0, y: 0, z: 0 };
    for (const [yaw, pitch] of [
      [0.7, 0.3],
      [-2.4, -1.1],
      [Math.PI, 1.2],
    ] as const) {
      orbitEye(target, yaw, pitch, 7.5, eye);
      expect(Math.hypot(eye.x - target.x, eye.y - target.y, eye.z - target.z)).toBeCloseTo(7.5, 9);
    }
  });

  it("rises with pitch and swings right with yaw", () => {
    const eye = { x: 0, y: 0, z: 0 };
    orbitEye(target, 0, 0.5, 4, eye);
    expect(eye.y).toBeGreaterThan(target.y);
    orbitEye(target, 0.5, 0, 4, eye);
    expect(eye.x).toBeGreaterThan(target.x);
  });
});
