import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import type { LensGraph, LensNode } from "@/lib/graph-lens";
import { glintCount, toLabGraph } from "./lab-graph";
import { starPlace } from "./sky/layout";
import { sphereDirection, type SpherePlace } from "@/scene/sphere";
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

function gap(x: SpherePlace, y: SpherePlace): number {
  return Math.hypot(x.yaw - y.yaw, x.pitch - y.pitch);
}

describe("the sky's star places", () => {
  it("are stable per node and gather a cluster together", () => {
    const a = starPlace({ id: "a", cluster: "p" });
    expect(starPlace({ id: "a", cluster: "p" })).toEqual(a);
    const b = starPlace({ id: "b", cluster: "p" });
    const far = starPlace({ id: "a", cluster: "q" });
    expect(gap(a, b)).toBeLessThan(0.33);
    expect(gap(a, far)).toBeGreaterThan(0);
    const [x, y, z] = sphereDirection(a);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
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
