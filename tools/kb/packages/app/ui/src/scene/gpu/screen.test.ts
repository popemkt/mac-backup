import { describe, expect, it } from "vitest";
import { PerspectiveCamera, WebGPUCoordinateSystem } from "three/webgpu";
import { pixelsPerUnit, toScreen, type ScreenPoint } from "./screen";

/** A camera as the WebGPU renderer uses it: WebGPU's coordinate system. */
function webgpuCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, 1.5, 10, 1000);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  camera.updateProjectionMatrix();
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

const SIZE = { width: 900, height: 600 };
const at = (): ScreenPoint => ({ x: 0, y: 0, depth: 0 });

describe("what is in view (toScreen)", () => {
  const camera = webgpuCamera();

  it("places a point in front of the camera", () => {
    const out = at();
    expect(toScreen({ x: 0, y: 0, z: 0 }, camera, SIZE, out)).toBe(true);
    expect(out).toEqual({ x: 450, y: 300, depth: 100 });
  });

  it("rejects a point between the eye and the near plane", () => {
    // 5 units in front of the eye; the near plane is at 10.
    expect(toScreen({ x: 0, y: 0, z: 95 }, camera, SIZE, at())).toBe(false);
  });

  it("rejects a point behind the eye and beyond the far plane", () => {
    expect(toScreen({ x: 0, y: 0, z: 130 }, camera, SIZE, at())).toBe(false);
    expect(toScreen({ x: 0, y: 0, z: -2000 }, camera, SIZE, at())).toBe(false);
  });
});

describe("a world length on screen (pixelsPerUnit)", () => {
  it("is the focal length over the depth", () => {
    const camera = webgpuCamera();
    const focal = 300 / Math.tan((50 * Math.PI) / 360);
    expect(pixelsPerUnit(camera, 600, 100)).toBeCloseTo(focal / 100);
  });
});
