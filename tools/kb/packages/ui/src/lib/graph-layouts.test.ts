import { describe, expect, it } from "vitest";
import type { LensEdge, LensNode } from "@/lib/graph-lens";
import {
  computeLayoutPositions,
  gridLayout,
  hierarchicalLayout,
  radialLayout,
} from "./graph-layouts";

function byKey(x: [string, unknown], y: [string, unknown]): number {
  return x[0].localeCompare(y[0]);
}

function nodes(ids: string[]): LensNode[] {
  return ids.map((id, i) => ({
    id,
    label: id,
    color: "#000",
    size: 5,
    clusterKey: "none",
    tags: [],
    degree: i,
  }));
}

describe("graph-layouts", () => {
  const size = { width: 800, height: 600 };

  it("force returns null (FA2 owns it)", () => {
    expect(computeLayoutPositions("force", nodes(["a"]), [], size)).toBeNull();
  });

  it("radial is deterministic for a fixture", () => {
    const a = radialLayout(nodes(["c", "a", "b"]), size);
    const b = radialLayout(nodes(["b", "c", "a"]), size);
    expect([...a.entries()].sort(byKey)).toEqual([...b.entries()].sort(byKey));
    expect(a.size).toBe(3);
  });

  it("grid assigns unique cells", () => {
    const pos = gridLayout(nodes(["n1", "n2", "n3", "n4"]), size);
    const pts = [...pos.values()];
    const keys = new Set(pts.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(4);
  });

  it("hierarchical layers by edge depth", () => {
    const ns = nodes(["root", "mid", "leaf"]);
    const edges: LensEdge[] = [
      { source: "root", target: "mid", kind: "child", weight: 1 },
      { source: "mid", target: "leaf", kind: "child", weight: 1 },
    ];
    const pos = hierarchicalLayout(ns, edges, size);
    expect(pos.get("root")!.x).toBeLessThan(pos.get("mid")!.x);
    expect(pos.get("mid")!.x).toBeLessThan(pos.get("leaf")!.x);
  });

  it("snapshots positions for regression", () => {
    const ns = nodes(["a", "b", "c", "d"]);
    const pos = radialLayout(ns, size);
    expect(pos.get("a")).toEqual({ x: 400, y: 72 });
    expect(pos.get("b")).toEqual({ x: 628, y: 300 });
    expect(pos.get("c")).toEqual({ x: 400, y: 528 });
    expect(pos.get("d")).toEqual({ x: 172, y: 300 });
  });
});
