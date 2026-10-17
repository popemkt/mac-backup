/**
 * The edge projection read as a graph to walk: every node's neighbours in
 * its undirected view, with the edges that join each pair kept whole, so a
 * walk is free to cross an edge against its direction and still say which
 * way the edge points. Trace and suggest both read it, over the edges
 * `collectEdges` projects.
 */
import { isSysPrefixed, SYSTEM_IDS } from "@kb/model";
import { collectEdges, type LensEdge, type LensSource } from "./edges.ts";
import type { EdgeKind } from "./lens.ts";
import { isScaffolding } from "./scaffolding.ts";

/** A node set's edges by kind, the tags each node carries, and which nodes are scaffolding. */
export interface GraphProjection {
  readonly edges: readonly LensEdge[];
  /**
   * The nodes the graph elides (`isScaffolding`). A walk never routes
   * through one, and suggest never offers one, unless asked to.
   */
  readonly scaffolding: ReadonlySet<string>;
  /**
   * Each node's tags: the targets of its `sys.f.type` that are not system
   * nodes, read from the nodes whatever the kinds, because a shared tag is a
   * reason two nodes relate even where the tag edge is not drawn.
   */
  readonly tags: ReadonlyMap<string, readonly string[]>;
}

/** The projection of every node in `nodes` under `kinds`. */
export function projectionOf(
  nodes: readonly LensSource[],
  kinds: ReadonlySet<EdgeKind>,
): GraphProjection {
  const tags = new Map<string, readonly string[]>();
  for (const n of nodes) {
    const own = (n.props[SYSTEM_IDS.typeField] ?? []).flatMap((pv) =>
      pv.t === "ref" && !isSysPrefixed(pv.v) ? [pv.v] : [],
    );
    if (own.length > 0) tags.set(n.id, [...new Set(own)]);
  }
  return {
    edges: collectEdges(nodes, new Set(nodes.map((n) => n.id)), kinds),
    scaffolding: new Set(nodes.filter(isScaffolding).map((n) => n.id)),
    tags,
  };
}

/** Each node's neighbours, and the edges joining it to each, either way round. */
export type Adjacency = ReadonlyMap<string, ReadonlyMap<string, readonly LensEdge[]>>;

export function adjacencyOf(edges: readonly LensEdge[]): Adjacency {
  const out = new Map<string, Map<string, LensEdge[]>>();
  const link = (a: string, b: string, edge: LensEdge) => {
    const row = out.get(a) ?? new Map<string, LensEdge[]>();
    out.set(a, row);
    row.set(b, [...(row.get(b) ?? []), edge]);
  };
  for (const edge of edges) {
    link(edge.source, edge.target, edge);
    link(edge.target, edge.source, edge);
  }
  return out;
}

/** How many distinct nodes `id` is joined to. */
export function degreeOf(adjacency: Adjacency, id: string): number {
  return adjacency.get(id)?.size ?? 0;
}

/** `id`'s neighbours, in id order, so every walk over them is deterministic. */
export function neighboursOf(adjacency: Adjacency, id: string): string[] {
  return [...(adjacency.get(id)?.keys() ?? [])].toSorted();
}
