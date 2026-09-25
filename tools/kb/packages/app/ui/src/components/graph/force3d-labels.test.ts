import { describe, expect, it } from "vitest";
import { PerspectiveCamera, WebGPUCoordinateSystem } from "three/webgpu";
import { focusDisc } from "./force3d-labels";
import { toScreen, type ScreenPoint } from "./force3d-screen";

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

describe("the focus disc labels keep clear of", () => {
  const camera = webgpuCamera();

  it("covers a focused node in view, sized by its depth", () => {
    const disc = focusDisc({ x: 0, y: 0, z: 0 }, 10, camera, SIZE);
    const focal = 300 / Math.tan((50 * Math.PI) / 360);
    const r = (10 * focal) / 100;
    expect(disc?.x).toBeCloseTo(450 - r);
    expect(disc?.width).toBeCloseTo(2 * r);
  });

  it("is not reserved for a node between the eye and the near plane, or behind the eye", () => {
    expect(focusDisc({ x: 0, y: 0, z: 95 }, 10, camera, SIZE)).toBeNull();
    expect(focusDisc({ x: 0, y: 0, z: 130 }, 10, camera, SIZE)).toBeNull();
  });

  it("is a new box per node, so two nodes in focus keep two discs", () => {
    const a = focusDisc({ x: -20, y: 0, z: 0 }, 5, camera, SIZE);
    const b = focusDisc({ x: 20, y: 0, z: 0 }, 5, camera, SIZE);
    expect(a).not.toBe(b);
    expect(a?.x).not.toBe(b?.x);
  });
});
