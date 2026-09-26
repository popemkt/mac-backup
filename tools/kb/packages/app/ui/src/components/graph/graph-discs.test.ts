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
import { DatascriptIndex } from "@/ds";
import { extractLensGraph, parsePerspective, resolveSize, type LensGraph } from "@/lib/graph-lens";
import { fa2Settings } from "./fa2-layout";
import { computeLayoutPositions } from "@/lib/graph-layouts";
import {
  clusterPlacement,
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
