/**
 * The 3D node layer answers a same-shape update (same ids, same links — the
 * scene's fast path, e.g. a lens `size-by` change) by re-reading every
 * encoding it draws, sizes included: the spheres and the pick radii follow.
 */
import { describe, expect, it } from "vitest";
import { Color } from "three/webgpu";
import { uniform } from "three/tsl";
import type { LensNode } from "@/lib/graph-lens";
import { EmphasisFade } from "@/lib/graph-fade";
import { topologyOf } from "./force3d-emphasis";
import { nodeLayer } from "./force3d-nodes";

function node(id: string, size: number): LensNode {
  return { id, label: id, color: "#888888", size, clusterKey: "r", tags: [], degree: 1 };
}

function colors() {
  return {
    ground: uniform(new Color()),
    edge: uniform(new Color()),
    hue: uniform(new Color()),
    ink: uniform(new Color()),
    accent: uniform(new Color()),
  };
}

describe("nodeLayer", () => {
  it("re-reads sizes on a same-shape update", () => {
    const before = [node("a", 1), node("b", 1)];
    const topology = topologyOf(before, [{ source: "a", target: "b", kind: "child", weight: 1 }]);
    const fades = {
      dim: new EmphasisFade(2, 0.2),
      glow: new EmphasisFade(2, 0.2, 0),
      focus: new EmphasisFade(2, 0.2, 0),
    };
    const layer = nodeLayer(topology, colors(), fades);
    const small = layer.radius(0);
    expect(layer.radius(1)).toBe(small);

    // Same ids and endpoints, a new size encoding.
    layer.restyle([node("a", 1), node("b", 27)]);
    expect(layer.radius(0)).toBe(small);
    // `radius` is what `update` writes into each instance and what picking reads.
    expect(layer.radius(1)).toBeCloseTo(small * 3, 5);
    layer.mesh.geometry.dispose();
  });
});
