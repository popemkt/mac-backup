import { describe, expect, it } from "vitest";
import { PerspectiveCamera, WebGPUCoordinateSystem } from "three/webgpu";
import { pickNode, type PickField } from "./force3d-pick";

function camera(): PerspectiveCamera {
  const c = new PerspectiveCamera(50, 1.5, 1, 1000);
  c.coordinateSystem = WebGPUCoordinateSystem;
  c.updateProjectionMatrix();
  c.position.set(0, 0, 100);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}

const SIZE = { width: 900, height: 600 };

function field(points: number[][], present = (_i: number) => true): PickField {
  const positions = new Float32Array(points.flat());
  return {
    positions: () => positions,
    count: () => points.length,
    radius: () => 2,
    present,
    idOf: (i) => (i >= 0 ? `n${i}` : undefined),
  };
}

describe("pickNode", () => {
  it("picks the node under the point, and the nearer of two stacked ones", () => {
    const nodes = field([
      [0, 0, -20],
      [0, 0, 10],
      [30, 0, 0],
    ]);
    expect(pickNode(nodes, camera(), SIZE, 450, 300)).toBe(1);
  });

  it("misses when nothing is within reach", () => {
    expect(pickNode(field([[0, 0, 0]]), camera(), SIZE, 20, 20)).toBe(-1);
  });

  it("never picks a node that is not present", () => {
    const nodes = field(
      [
        [0, 0, 0],
        [0, 0, -30],
      ],
      (i) => i !== 0,
    );
    expect(pickNode(nodes, camera(), SIZE, 450, 300)).toBe(1);
  });

  it("never picks a node behind the eye", () => {
    expect(pickNode(field([[0, 0, 150]]), camera(), SIZE, 450, 300)).toBe(-1);
  });
});
