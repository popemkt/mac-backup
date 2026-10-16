/**
 * The graph, for a lab study that chooses to read it (the Sky does; the lab
 * does not require it).
 *
 * There is no lab data path. The nodes and edges are the node-link graph of
 * the default view the graph opens on, over the page's wire nodes and index,
 * which the graph's browser half answers (`NodeLinkGraphService`), so a node
 * the graph hides the lab hides too. The lab adds only what the wire
 * node already carries and the lens does not: how recently each node
 * changed. Only a study that reads the graph asks, and it is offered only
 * while the graph provides the service (`LabStudyPoint`).
 */
import { useMemo } from "react";
import type { WireNode } from "@kb/contracts";
import {
  currentService,
  NodeLinkGraphService,
  useIndex,
  useWireNodes,
  type NodeLinkGraph,
} from "@kb/ui-sdk";

export interface LabNode {
  readonly id: string;
  readonly label: string;
  readonly degree: number;
  /** The lens cluster (parent by default): nodes that sit together. */
  readonly cluster: string;
  /** 1 for the most recently updated node, falling to 0 for the stalest. */
  readonly recency: number;
  /** Among the few most recently updated: drawn as a bright glint. */
  readonly glint: boolean;
}

interface LabEdge {
  readonly source: string;
  readonly target: string;
}

export interface LabGraph {
  readonly nodes: readonly LabNode[];
  readonly edges: readonly LabEdge[];
}

/** How many of the most recently updated nodes glint: a few, never most. */
export function glintCount(nodes: number): number {
  return Math.min(nodes, Math.max(3, Math.min(24, Math.round(nodes * 0.04))));
}

function updatedMs(node: WireNode | undefined): number {
  const ms = node === undefined ? Number.NaN : Date.parse(node.updatedAt);
  return Number.isNaN(ms) ? 0 : ms;
}

export function toLabGraph(lens: NodeLinkGraph, wireNodes: readonly WireNode[]): LabGraph {
  const wire = new Map(wireNodes.map((node) => [node.id, node]));
  const byRecency = lens.nodes
    .map((node) => ({ id: node.id, at: updatedMs(wire.get(node.id)) }))
    .toSorted((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  const rank = new Map(byRecency.map((entry, index) => [entry.id, index]));
  const last = Math.max(1, lens.nodes.length - 1);
  const glints = glintCount(lens.nodes.length);
  const nodes = lens.nodes.map((node): LabNode => {
    const place = rank.get(node.id) ?? last;
    return {
      id: node.id,
      label: node.label,
      degree: node.degree,
      cluster: node.clusterKey,
      recency: 1 - place / last,
      glint: place < glints,
    };
  });
  return { nodes, edges: lens.edges.map(({ source, target }) => ({ source, target })) };
}

/** No graph: what a study is drawn from while the index loads, or there is no perspective. */
export const NO_GRAPH: LabGraph = { nodes: [], edges: [] };

/** The graph's node-link graphs. Only a study offered by the lab's graph child asks, so it is held. */
function nodeLinkGraphs() {
  const graphs = currentService(NodeLinkGraphService);
  if (graphs === undefined) throw new Error("no NodeLinkGraphService: the graph is not loaded");
  return graphs;
}

/** The lab's graph: the default view's node-link graph over the live store. */
export function useLabGraph(): LabGraph {
  const wireNodes = useWireNodes();
  const index = useIndex();
  return useMemo(() => {
    const lens = index === null ? null : nodeLinkGraphs().ofView(index, wireNodes, null);
    return lens === null ? NO_GRAPH : toLabGraph(lens, wireNodes);
  }, [wireNodes, index]);
}
