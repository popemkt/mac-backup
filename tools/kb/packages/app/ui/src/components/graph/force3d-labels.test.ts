import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { Group, PerspectiveCamera, WebGPUCoordinateSystem } from "three/webgpu";
import { EmphasisFade } from "@/lib/graph-fade";
import type { LensNode } from "@/lib/graph-lens";
import { topologyOf } from "./force3d-emphasis";
import { LabelLayer, focusDisc } from "./force3d-labels";

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

describe("a 3D label and its node's arrival", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  beforeAll(() => {
    const dom = new Window();
    const canvasProto = dom.HTMLCanvasElement.prototype as unknown as {
      getContext: (kind: string) => unknown;
    };
    canvasProto.getContext = () =>
      new Proxy(
        { measureText: (text: string) => ({ width: text.length * 6 }) },
        {
          get: (target, key) => (key === "measureText" ? target.measureText : () => {}),
          set: () => true,
        },
      );
    const globals = {
      window: dom,
      document: dom.document,
      getComputedStyle: dom.getComputedStyle.bind(dom),
    };
    for (const [key, value] of Object.entries(globals)) {
      saved.set(key, g[key]);
      g[key] = value;
    }
  });
  afterAll(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  });

  it("shows only once its node has arrived, as in 2D (lib/graph-arrival)", () => {
    const nodes: LensNode[] = [
      { id: "n", label: "a node", color: "#888", size: 3, clusterKey: "r", tags: [], degree: 1 },
    ];
    const topology = topologyOf(nodes, []);
    const layer = new LabelLayer(new Group(), topology, {
      ground: "#000",
      edge: "#000",
      hue: "#888",
      ink: "#fff",
      accent: "#f80",
    });
    const camera = webgpuCamera();
    layer.resize(camera, SIZE.height);
    layer.want(new Set([0]));
    const fades = {
      dim: new EmphasisFade(1, 0.2),
      glow: new EmphasisFade(1, 0.2, 0),
      lift: new EmphasisFade(1, 0.2, 0),
      focus: new EmphasisFade(1, 0.2, 0),
    };
    const shown = (arrival: number) => {
      layer.frame(
        new Float32Array([0, 0, 0]),
        camera,
        SIZE,
        { ...fades, arrival: new Float32Array([arrival]) },
        () => 4,
      );
      return layer.visibleCount();
    };
    expect(shown(0.3)).toBe(0);
    expect(shown(1)).toBe(1);
    layer.dispose();
  });
});
