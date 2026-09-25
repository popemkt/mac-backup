import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three/webgpu";
import { focusDisc } from "./force3d-labels";

describe("the focus disc labels keep clear of", () => {
  const camera = new PerspectiveCamera(50, 1.5, 1, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  it("covers a focused node in front of the camera", () => {
    const at = new Vector3(0, 0, 0).project(camera);
    const disc = focusDisc(at, 20, 900, 600);
    expect(disc).toEqual({ x: 430, y: 280, width: 40, height: 40 });
  });

  it("is not reserved for a focused node behind the camera (z > 1 after projection)", () => {
    const behind = new Vector3(0, 0, 130).project(camera);
    expect(behind.z).toBeGreaterThan(1);
    expect(focusDisc(behind, 5000, 900, 600)).toBeNull();
  });

  it("is a new box per node, so two nodes in focus keep two discs", () => {
    const a = focusDisc({ x: -0.5, y: 0, z: 0.5 }, 10, 900, 600);
    const b = focusDisc({ x: 0.5, y: 0, z: 0.5 }, 10, 900, 600);
    expect(a).not.toBe(b);
    expect(a?.x).not.toBe(b?.x);
  });
});
