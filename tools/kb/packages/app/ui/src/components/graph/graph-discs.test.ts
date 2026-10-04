/**
 * A 2D node is a disc in the layout's space, and no two discs overlap once
 * the layout has settled (`graph-discs`, DESIGN-UI → Graph). Proved on the
 * layout the 2D renderer runs — ForceAtlas2 with `fa2Settings`, then
 * `separateDiscs` — over the fixture graph, over a dense graph of hubs
 * ringed by leaves (where oversized, overlapping hubs used to show), and on
 * the cluster and placed (radial, hierarchical, grid) layouts.
 */
import { describe, expect, it } from "vitest";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { present } from "@kb/model";
import { fixtureGraph } from "@/api/fixture-graph";
import {
  DatascriptIndex,
  extractLensGraph,
  parsePerspective,
  resolveSize,
  type LensGraph,
} from "@kb/ui-sdk";
import { fa2Settings } from "./fa2-layout";
import { computeLayoutPositions } from "@/lib/graph-layouts";
import {
  clusterPlacement,
  DiscSettle,
  discRadius,
  MAX_DISC_RADIUS,
  discSpacing,
  linkWidth,
  separateDiscs,
} from "./graph-discs";

/** How far two discs may overlap after settle: a hair, in layout units. */
const TOLERANCE = 0.05;

type Disc = { x: number; y: number; r: number };

function discsOf(graph: Graph): Disc[] {
  return graph.mapNodes((_, a) => ({ x: Number(a.x), y: Number(a.y), r: Number(a.size) }));
}

function worstOverlap(discs: readonly Disc[]): number {
  let worst = 0;
  for (let i = 0; i < discs.length; i++)
    for (let j = i + 1; j < discs.length; j++) {
      const a = present(discs[i], "disc");
      const b = present(discs[j], "disc");
      worst = Math.max(worst, a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y));
    }
  return worst;
}

function medianNearest(discs: readonly Disc[]): number {
  const nearest = discs
    .map((a) =>
      Math.min(...discs.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.y - b.y))),
    )
    .toSorted((a, b) => a - b);
  return nearest[nearest.length >> 1] ?? 0;
}

/** The lens graph as sigma receives it, laid out and settled as the 2D renderer does. */
function settled(lens: LensGraph): Graph {
  const graph = new Graph({ multi: true, type: "directed" });
  lens.nodes.forEach((n, i) =>
    graph.addNode(n.id, {
      x: Math.cos(i * 2.4) * Math.sqrt(i + 1) * 12,
      y: Math.sin(i * 2.4) * Math.sqrt(i + 1) * 12,
      size: discRadius(n.size),
    }),
  );
  for (const e of lens.edges)
    if (graph.hasNode(e.source) && graph.hasNode(e.target)) graph.addEdge(e.source, e.target);
  forceAtlas2.assign(graph, { iterations: 300, settings: fa2Settings(graph) });
  separateDiscs(graph);
  return graph;
}

function fixtureLens(): LensGraph {
  const nodes = fixtureGraph.nodes;
  const lens = present(
    nodes.find((n) => n.id === "lens.all-mentions"),
    "the fixture's perspective",
  );
  return extractLensGraph(new DatascriptIndex(nodes), nodes, parsePerspective(lens), {
    includeSystemNodes: true,
  });
}

/** Six hubs of eighty leaves each, and a few links between the hubs. */
function denseLens(): LensGraph {
  const hubs = Array.from({ length: 6 }, (_, h) => `hub.${h}`);
  const leaves = hubs.flatMap((hub) => Array.from({ length: 80 }, (_, i) => `${hub}.${i}`));
  const edges = [
    ...leaves.map((leaf) => ({ source: leaf.replace(/\.\d+$/, ""), target: leaf })),
    ...hubs.slice(1).map((hub, i) => ({ source: present(hubs[i], "hub"), target: hub })),
  ].map((e) => ({ ...e, kind: "child" as const, weight: 1 }));
  const degree = (id: string) => edges.filter((e) => e.source === id || e.target === id).length;
  const node = (id: string) => ({
    id,
    label: id,
    color: "#888",
    size: resolveSize("degree", degree(id), 0),
    clusterKey: id.split(".").slice(0, 2).join("."),
    tags: [],
    degree: degree(id),
  });
  return { nodes: [...hubs, ...leaves].map(node), edges, dropped: 0, queryError: null };
}

describe("2D discs after the layout settles", () => {
  for (const [name, lens] of [
    ["the fixture graph", fixtureLens],
    ["a dense graph of hubs and leaves", denseLens],
  ] as const) {
    it(`never overlap in ${name}, and the largest stays within its bound`, () => {
      const graph = lens();
      expect(graph.nodes.length).toBeGreaterThan(10);
      const discs = discsOf(settled(graph));
      expect(worstOverlap(discs)).toBeLessThanOrEqual(TOLERANCE);
      const largest = Math.max(...discs.map((d) => d.r));
      // Bounded absolutely (the lens size's cap) and against the settled spacing.
      expect(largest).toBeLessThanOrEqual(MAX_DISC_RADIUS);
      expect(largest).toBeLessThanOrEqual(1.5 * medianNearest(discs));
    });
  }

  it("spaces a hub-and-leaves group by its radii before any separation", () => {
    const { nodes } = denseLens();
    const group = nodes.filter((n) => n.clusterKey === "hub.0");
    expect(group.length).toBeGreaterThan(40);
    const placed = clusterPlacement(group);
    const discs = group.map((n) => ({ ...present(placed.get(n.id), n.id), r: discRadius(n.size) }));
    // The packing alone keeps the discs apart: no separation has run.
    expect(worstOverlap(discs)).toBeLessThanOrEqual(TOLERANCE);
    // And it reads the radii: a larger hub pushes its leaves further out.
    const hub = present(group[0], "hub");
    const grown = clusterPlacement([{ ...hub, size: hub.size * 1.5 }, ...group.slice(1)]);
    const reach = (at: Map<string, { x: number; y: number }>) =>
      Math.min(
        ...group.slice(1).map((n) => {
          const p = present(at.get(n.id), n.id);
          const c = present(at.get(hub.id), hub.id);
          return Math.hypot(p.x - c.x, p.y - c.y);
        }),
      );
    expect(reach(grown)).toBeGreaterThan(reach(placed));
  });

  it("settle again when the discs grow after the layout is still, and only then", () => {
    // Packed as clusters with every node the same size (size-by fixed), and settled so …
    const byDegree = denseLens();
    const fixed = byDegree.nodes.map((n) => ({ ...n, size: resolveSize("fixed", 0, 0) }));
    const placed = clusterPlacement(fixed);
    const graph = new Graph();
    for (const n of fixed)
      graph.addNode(n.id, { ...present(placed.get(n.id), n.id), size: discRadius(n.size) });
    const settle = new DiscSettle();
    settle.written(graph, fixed, { reshaped: true, moving: false });
    expect(worstOverlap(discsOf(graph))).toBeLessThanOrEqual(TOLERANCE);
    // … a write that changes nothing moves nothing.
    const at = () => JSON.stringify(graph.mapNodes((_, a) => [a.x, a.y]));
    const still = at();
    settle.written(graph, fixed, { reshaped: false, moving: false });
    expect(at()).toBe(still);
    // Then sized by degree: the hubs grow over their leaves where they stand.
    for (const n of byDegree.nodes) graph.setNodeAttribute(n.id, "size", discRadius(n.size));
    expect(worstOverlap(discsOf(graph))).toBeGreaterThan(TOLERANCE);
    // While a layout is still moving, its own settle will separate them: not now.
    const moving = new DiscSettle();
    moving.written(graph, fixed, { reshaped: false, moving: true });
    moving.written(graph, byDegree.nodes, { reshaped: false, moving: true });
    expect(worstOverlap(discsOf(graph))).toBeGreaterThan(TOLERANCE);
    // On the still layout, the same settle that saw the fixed sizes separates them now.
    settle.written(graph, byDegree.nodes, { reshaped: false, moving: false });
    expect(worstOverlap(discsOf(graph))).toBeLessThanOrEqual(TOLERANCE);
  });

  for (const counts of [
    [40, 12],
    [40, 25, 8],
  ]) {
    it(`keeps ${counts.length} unequal cluster groups apart, before and after separation`, () => {
      const nodes = counts.flatMap((count, g) => {
        const hub = { id: `g${g}.hub`, clusterKey: `g${g}`, size: resolveSize("degree", count, 0) };
        const leaves = Array.from({ length: count }, (_, i) => ({
          id: `g${g}.${i}`,
          clusterKey: `g${g}`,
          size: resolveSize("degree", 1, 0),
        }));
        return [hub, ...leaves];
      });
      const placed = clusterPlacement(nodes);
      const graph = new Graph();
      for (const n of nodes)
        graph.addNode(n.id, { ...present(placed.get(n.id), n.id), size: discRadius(n.size) });
      expect(worstOverlap(discsOf(graph))).toBeLessThanOrEqual(TOLERANCE);
      separateDiscs(graph);
      expect(worstOverlap(discsOf(graph))).toBeLessThanOrEqual(TOLERANCE);
    });
  }

  it("never overlap in the cluster placement, once separated", () => {
    const { nodes } = denseLens();
    const graph = new Graph();
    const placed = clusterPlacement(nodes);
    for (const n of nodes)
      graph.addNode(n.id, { ...present(placed.get(n.id), n.id), size: discRadius(n.size) });
    separateDiscs(graph);
    expect(worstOverlap(discsOf(graph))).toBeLessThanOrEqual(TOLERANCE);
  });

  for (const layout of ["radial", "hierarchical", "grid"] as const) {
    it(`never overlap in the ${layout} layout, once separated`, () => {
      const { nodes, edges } = denseLens();
      const placed = present(
        computeLayoutPositions(layout, nodes, edges, undefined, discSpacing),
        layout,
      );
      const graph = new Graph();
      for (const n of nodes)
        graph.addNode(n.id, { ...present(placed.get(n.id), n.id), size: discRadius(n.size) });
      separateDiscs(graph);
      expect(worstOverlap(discsOf(graph))).toBeLessThanOrEqual(TOLERANCE);
    });
  }

  it("draws a link in the same units: a hairline beside a leaf, thicker as it repeats", () => {
    expect(linkWidth(1)).toBeLessThan(discRadius(resolveSize("degree", 1, 0)));
    expect(linkWidth(4)).toBeCloseTo(2 * linkWidth(1), 9);
  });
});
