/** The spanning tree the tree renderers draw of the edge projection (`buildTreeForest`). */
import { describe, expect, test } from "bun:test";
import { buildTreeForest, type LensEdge, type LensTreeNode } from "../src/index.ts";

const lensNode = (id: string) => ({ id, label: id, color: "#888888", size: 5 });
const child = (source: string, target: string): LensEdge => ({
  source,
  target,
  kind: "child",
  weight: 1,
});
const flatten = (forest: readonly LensTreeNode[]): string[] =>
  forest.flatMap((n) => [n.id, ...flatten(n.children)]);

describe("buildTreeForest", () => {
  test("projects cycles and shared descendants once without altering relationships", () => {
    const nodes = ["a", "b", "c", "d"].map(lensNode);
    const edges = [
      child("a", "b"),
      child("a", "c"),
      child("b", "d"),
      child("c", "d"),
      child("d", "a"),
    ];
    expect(flatten(buildTreeForest(nodes, edges, null)).toSorted()).toEqual(["a", "b", "c", "d"]);
    expect(edges).toHaveLength(5);
  });

  test("a focus is the one root, and a focus outside the set falls back to the forest", () => {
    const nodes = ["a", "b", "c"].map(lensNode);
    const edges = [child("a", "b"), child("c", "a")];
    expect(buildTreeForest(nodes, edges, "a").map((n) => n.id)).toEqual(["a"]);
    expect(flatten(buildTreeForest(nodes, edges, "a"))).toEqual(["a", "b"]);
    expect(buildTreeForest(nodes, edges, "gone").map((n) => n.id)).toEqual(["c"]);
  });

  test("an edge to a node outside the set is not a branch", () => {
    expect(buildTreeForest([lensNode("a")], [child("a", "gone")], null)).toEqual([
      { ...lensNode("a"), children: [] },
    ]);
  });
});
