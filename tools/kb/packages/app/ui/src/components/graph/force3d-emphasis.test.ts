import { describe, expect, it } from "vitest";
import type { LensEdge, LensNode } from "@/lib/graph-lens";
import { EmphasisFade } from "@/lib/graph-fade";
import {
  particleLinks,
  setEmphasisTargets,
  topologyOf,
  type Force3dFades,
} from "./force3d-emphasis";

function node(id: string, degree = 1): LensNode {
  return { id, label: id, color: "#888", size: 3, clusterKey: "root", tags: [], degree };
}
function edge(source: string, target: string, weight = 1): LensEdge {
  return { source, target, kind: "child", weight };
}

const nodes = [node("hub", 5), node("a"), node("b"), node("c"), node("far")];
const edges = [edge("hub", "a"), edge("hub", "b", 3), edge("c", "hub"), edge("far", "c")];

function fades(count: number): Force3dFades {
  return {
    dim: new EmphasisFade(count, 0.2),
    glow: new EmphasisFade(count, 0.2, 0),
    lift: new EmphasisFade(count, 0.2, 0),
    focus: new EmphasisFade(count, 0.2, 0),
  };
}

describe("3D particles follow the focus", () => {
  const topology = topologyOf(nodes, edges);

  it("run on nothing while nothing is selected or hovered", () => {
    expect(particleLinks(topology, null, 96)).toEqual([]);
  });

  it("run on the selected node's links only, heaviest first", () => {
    const links = particleLinks(topology, "hub", 96);
    expect(links).toHaveLength(3);
    expect(topology.edges[links[0] ?? -1]?.target).toBe("b");
    const touched = links.map((l) => topology.edges[l]);
    expect(touched.every((e) => e?.source === "hub" || e?.target === "hub")).toBe(true);
    expect(particleLinks(topology, "far", 96)).toHaveLength(1);
  });

  it("are capped", () => {
    expect(particleLinks(topology, "hub", 2)).toHaveLength(2);
  });

  it("ignore a focus the graph does not hold", () => {
    expect(particleLinks(topology, "gone", 96)).toEqual([]);
  });
});

describe("3D emphasis targets", () => {
  const topology = topologyOf(nodes, edges);

  it("glow only the focused, and the best connected, at rest", () => {
    const f = fades(nodes.length);
    setEmphasisTargets(topology, { selectedNodeId: null }, null, f);
    f.dim.snap();
    f.glow.snap();
    expect([...f.dim.values]).toEqual([1, 1, 1, 1, 1]);
    // `hub` is the one prominent node (degree 5, top share).
    expect(f.glow.values[0]).toBeGreaterThan(0);
    expect([...f.glow.values].slice(1)).toEqual([0, 0, 0, 0]);
  });

  it("light the selection's neighbourhood, dim the rest, and never glow a dimmed node", () => {
    const f = fades(nodes.length);
    setEmphasisTargets(topology, { selectedNodeId: "c" }, null, f);
    f.dim.snap();
    f.glow.snap();
    f.focus.snap();
    const at = (id: string) => topology.index.get(id) ?? -1;
    expect(f.dim.values[at("c")]).toBe(1);
    expect(f.dim.values[at("far")]).toBe(1);
    expect(f.dim.values[at("hub")]).toBe(1);
    expect(f.dim.values[at("a")]).toBeLessThan(1);
    expect(f.glow.values[at("a")]).toBe(0);
    expect(f.glow.values[at("c")]).toBeGreaterThan(f.glow.values[at("far")] ?? 1);
    expect(f.focus.values[at("c")]).toBe(1);
    expect(f.focus.values[at("hub")]).toBe(0);
  });

  it("let a hover focus only while nothing is selected", () => {
    const f = fades(nodes.length);
    setEmphasisTargets(topology, { selectedNodeId: "a" }, "far", f);
    f.focus.snap();
    expect(f.focus.values[topology.index.get("a") ?? -1]).toBe(1);
    expect(f.focus.values[topology.index.get("far") ?? -1]).toBe(0);
  });
});
