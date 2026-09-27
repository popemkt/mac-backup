/**
 * The 3D node layer answers a same-shape update (same ids, same links — the
 * scene's fast path, e.g. a lens `size-by` change) by re-reading every
 * encoding it draws, sizes included: the spheres and the pick radii follow.
 */
import { describe, expect, it } from "vitest";
import { BoxGeometry, Color, type InstancedMesh } from "three/webgpu";
import { uniform } from "three/tsl";
import type { LensNode } from "@/lib/graph-lens";
import { EmphasisFade } from "@/lib/graph-fade";
import { topologyOf } from "./force3d-emphasis";
import { disposeGraph } from "@/scene/gpu/dispose";
import { CUBE_HALF_EDGE, solidLayer } from "./force3d-nodes";
import { GRAPH_THEMES } from "./graph-themes";

function node(id: string, size: number): LensNode {
  return { id, label: id, color: "#888888", size, clusterKey: "r", tags: [], degree: 1 };
}

const PALETTE = { ground: "#000", edge: "#000", hue: "#888", ink: "#fff", accent: "#f80" };

function colors() {
  return {
    ground: uniform(new Color()),
    edge: uniform(new Color()),
    hue: uniform(new Color()),
    ink: uniform(new Color()),
    accent: uniform(new Color()),
  };
}

describe("the solid node layer", () => {
  it("re-reads sizes on a same-shape update", () => {
    const before = [node("a", 1), node("b", 1)];
    const topology = topologyOf(before, [{ source: "a", target: "b", kind: "child", weight: 1 }]);
    const fades = {
      dim: new EmphasisFade(2, 0.2),
      glow: new EmphasisFade(2, 0.2, 0),
      lift: new EmphasisFade(2, 0.2, 0),
      focus: new EmphasisFade(2, 0.2, 0),
    };
    const layer = solidLayer("sphere")({
      topology,
      colors: colors(),
      fades,
      theme: GRAPH_THEMES.matte,
      palette: PALETTE,
    });
    const small = layer.radius(0);
    expect(layer.radius(1)).toBe(small);

    // Same ids and endpoints, a new size encoding.
    layer.restyle([node("a", 1), node("b", 27)]);
    expect(layer.radius(0)).toBe(small);
    // `radius` is what `update` writes into each instance and what picking reads.
    expect(layer.radius(1)).toBeCloseTo(small * 3, 5);
    disposeGraph(layer.mesh);
  });

  it("draws a cube of the sphere's volume, radius for radius, in one instanced draw", () => {
    const nodes = [node("a", 1), node("b", 8)];
    const topology = topologyOf(nodes, []);
    const fades = {
      dim: new EmphasisFade(2, 0.2),
      glow: new EmphasisFade(2, 0.2, 0),
      lift: new EmphasisFade(2, 0.2, 0),
      focus: new EmphasisFade(2, 0.2, 0),
    };
    const init = { topology, colors: colors(), fades, palette: PALETTE };
    const sphere = solidLayer("sphere")({ ...init, theme: GRAPH_THEMES.matte });
    const cube = solidLayer("cube")({ ...init, theme: GRAPH_THEMES.cube });
    // Picked, framed and labelled by the same radius as the sphere it replaces.
    expect(cube.radius(1)).toBe(sphere.radius(1));
    const mesh = cube.mesh as InstancedMesh;
    expect(mesh.geometry).toBeInstanceOf(BoxGeometry);
    expect(mesh.count).toBe(2);
    // Same volume as the unit sphere: (2h)³ = 4π/3.
    expect((2 * CUBE_HALF_EDGE) ** 3).toBeCloseTo((4 * Math.PI) / 3, 6);
    disposeGraph(sphere.mesh);
    disposeGraph(cube.mesh);
  });
});
