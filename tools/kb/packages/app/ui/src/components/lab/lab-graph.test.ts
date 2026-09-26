import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import type { LensGraph, LensNode } from "@/lib/graph-lens";
import { glintCount, toLabGraph } from "./lab-graph";
import { starPoint } from "./sky/layout";
import { LAB_SCENE_IDS, labPath, labSceneOf, matchLab } from "./routes";

function lensNode(id: string, degree = 1, clusterKey = "root"): LensNode {
  return { id, label: id, color: "#888", size: 3, clusterKey, tags: [], degree };
}

function wire(id: string, updatedAt: string): WireNode {
  return { id, text: id, props: {}, children: [], createdAt: updatedAt, updatedAt };
}

describe("toLabGraph", () => {
  it("ranks recency from the wire nodes and makes the newest few glint", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `n${i}`);
    const lens: LensGraph = {
      nodes: ids.map((id) => lensNode(id)),
      edges: [{ source: "n0", target: "n1", kind: "child", weight: 1 }],
      dropped: 0,
      queryError: null,
    };
    const wires = ids.map((id, i) =>
      wire(id, `2026-09-${String(10 + i).padStart(2, "0")}T00:00:00Z`),
    );
    const graph = toLabGraph(lens, wires);
    const newest = graph.nodes.find((n) => n.id === "n9");
    const oldest = graph.nodes.find((n) => n.id === "n0");
    expect(newest?.recency).toBe(1);
    expect(oldest?.recency).toBe(0);
    expect(graph.nodes.filter((n) => n.glint).map((n) => n.id)).toEqual(["n7", "n8", "n9"]);
    expect(graph.edges).toEqual([{ source: "n0", target: "n1" }]);
  });

  it("glints a few, never most", () => {
    expect(glintCount(0)).toBe(0);
    expect(glintCount(10)).toBe(3);
    expect(glintCount(300)).toBe(12);
    expect(glintCount(10_000)).toBe(24);
  });
});

type Point = readonly [number, number, number];

function gap(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe("the sky's star points", () => {
  it("are stable per node, gather a cluster together, and stand at depth", () => {
    const a = starPoint({ id: "a", cluster: "p" });
    expect(starPoint({ id: "a", cluster: "p" })).toEqual(a);
    const b = starPoint({ id: "b", cluster: "p" });
    const far = starPoint({ id: "a", cluster: "q" });
    const depth = Math.hypot(...a);
    // Siblings are a small group in the volume; another cluster is elsewhere.
    expect(gap(a, b)).toBeLessThan(depth * 0.4);
    expect(gap(a, far)).toBeGreaterThan(0);
    for (const id of ["a", "b", "c", "d"]) {
      const r = Math.hypot(...starPoint({ id, cluster: id }));
      expect(r).toBeGreaterThan(45);
      expect(r).toBeLessThan(160);
    }
  });
});

describe("lab routes", () => {
  it("own /lab and each study, and leave anything else alone", () => {
    expect(matchLab("/lab")).toEqual({ scene: LAB_SCENE_IDS[0] });
    for (const id of LAB_SCENE_IDS) {
      expect(matchLab(labPath(id))).toEqual({ scene: id });
      expect(labSceneOf({ scene: id })).toBe(id);
    }
    expect(matchLab("/lab/nope")).toBeNull();
    expect(matchLab("/labs")).toBeNull();
    expect(labSceneOf({})).toBe(LAB_SCENE_IDS[0]);
  });
});
