/**
 * The graph, for a lab study that chooses to read it (the Sky does; the lab
 * does not require it).
 *
 * There is no lab data path. The nodes and edges are `extractLensGraph` over
 * the outline store's wire nodes and index, through the same default
 * perspective the graph page opens on (`resolvePerspective`), so a node the
 * graph hides the lab hides too. The lab adds only what the wire node already carries and the lens does not:
 * how recently each node changed.
 */
import { useMemo } from "react";
import type { WireNode } from "@kb/contracts";
import {
  extractLensGraph,
  listPerspectiveNodes,
  parsePerspective,
  resolvePerspective,
  type LensGraph,
} from "@/lib/graph-lens";
import { useOutlineStore } from "@/stores/outline.store";

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

export function toLabGraph(lens: LensGraph, wireNodes: readonly WireNode[]): LabGraph {
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

/** The lab's graph: the default perspective's lens over the live store. */
export function useLabGraph(): LabGraph {
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  const index = useOutlineStore((s) => s.index);
  return useMemo(() => {
    const perspective = resolvePerspective(
      listPerspectiveNodes(wireNodes).map(parsePerspective),
      null,
    );
    if (index === null || perspective === null) return { nodes: [], edges: [] };
    return toLabGraph(extractLensGraph(index, wireNodes, perspective), wireNodes);
  }, [wireNodes, index]);
}
