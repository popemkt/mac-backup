/**
 * What each node and link of the 3D graph should look like right now, as
 * targets its eased emphasis (`lib/graph-fade.ts`) approaches: how present a
 * node is (the shared search/filter/neighbourhood alpha of
 * `graph-interaction`), how brightly it glows, whether it is the node in
 * focus — and which links carry the direction particles.
 *
 * Only the selected, hovered, searched-for and most-connected nodes glow, and
 * only glowing values leave the displayable range, so only they bloom (Lab
 * principle L2). Particles run along the focused node's links alone: one
 * hero motion, answering the user (M4). Pure data, no three.
 */
import type { LensEdge, LensNode } from "@/lib/graph-lens";
import type { EmphasisFade } from "@/lib/graph-fade";
import { graphEmphasisAlpha, graphNeighborhood, type GraphEmphasis } from "@/lib/graph-interaction";

/** The graph as the scene indexes it: node order, link pairs, incidence. */
export interface Force3dTopology {
  readonly nodes: readonly LensNode[];
  readonly edges: readonly LensEdge[];
  readonly index: ReadonlyMap<string, number>;
  /** Source and target node index per link. */
  readonly links: Int32Array;
  /** Link indices touching each node. */
  readonly incident: readonly (readonly number[])[];
  /**
   * How much each node glows unprompted, by degree: the few best-connected
   * hubs cross the bloom threshold, the next tier is only a little brighter,
   * the rest stay matte.
   */
  readonly prominence: Float32Array;
}

/** The share of nodes, by degree, in each unprompted tier, and its glow. */
const HUBS = { share: 0.03, glow: 0.5 } as const;
const RISING = { share: 0.1, glow: 0.1 } as const;
/** …and the degree a node needs to be in a tier at all. */
const PROMINENT_DEGREE = 4;

export function topologyOf(
  nodes: readonly LensNode[],
  edges: readonly LensEdge[],
): Force3dTopology {
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const kept = edges.filter((e) => index.has(e.source) && index.has(e.target));
  const links = new Int32Array(kept.length * 2);
  const incident: number[][] = nodes.map(() => []);
  kept.forEach((edge, i) => {
    const a = index.get(edge.source) ?? 0;
    const b = index.get(edge.target) ?? 0;
    links[i * 2] = a;
    links[i * 2 + 1] = b;
    incident[a]?.push(i);
    if (b !== a) incident[b]?.push(i);
  });
  const ranked = nodes
    .map((node, i) => ({ i, degree: node.degree }))
    .filter((n) => n.degree >= PROMINENT_DEGREE)
    .toSorted((a, b) => b.degree - a.degree || a.i - b.i);
  const prominence = new Float32Array(nodes.length);
  const hubs = Math.max(1, Math.round(nodes.length * HUBS.share));
  const rising = hubs + Math.round(nodes.length * RISING.share);
  ranked.forEach((n, rank) => {
    if (rank < hubs) prominence[n.i] = HUBS.glow;
    else if (rank < rising) prominence[n.i] = RISING.glow;
  });
  return {
    nodes,
    edges: kept,
    index,
    links,
    incident,
    prominence,
  };
}

export interface Force3dFades {
  /** 1 = fully present, down to the shared dim alpha. */
  readonly dim: EmphasisFade;
  /** 0–1: how far past white the node's light goes. */
  readonly glow: EmphasisFade;
  /** 1 for the node in focus (selected, else hovered). */
  readonly focus: EmphasisFade;
}

/** Glow per role; a dimmed node never glows. */
const GLOW = { focus: 0.7, hover: 0.6, match: 0.5, neighbour: 0.12 } as const;

/** The node in focus: the selection wins over the hover. */
export function focusOf(state: GraphEmphasis, hovered: string | null): string | null {
  return state.selectedNodeId ?? hovered;
}

/** Set every node's targets for `state` with `hovered` under the pointer. */
export function setEmphasisTargets(
  topology: Force3dTopology,
  state: GraphEmphasis,
  hovered: string | null,
  fades: Force3dFades,
): void {
  const active = focusOf(state, hovered);
  const neighbourhood = graphNeighborhood(active, topology.edges);
  topology.nodes.forEach((node, i) => {
    const alpha = graphEmphasisAlpha(node.id, state, neighbourhood);
    fades.dim.setTarget(i, alpha);
    const glow =
      alpha < 1
        ? 0
        : node.id === active
          ? GLOW.focus
          : node.id === hovered
            ? GLOW.hover
            : state.highlightIds?.has(node.id) === true
              ? GLOW.match
              : Math.max(topology.prominence[i] ?? 0, active !== null ? GLOW.neighbour : 0);
    fades.glow.setTarget(i, glow);
    fades.focus.setTarget(i, node.id === active ? 1 : 0);
  });
}

/**
 * The links that carry particles: those touching the node in focus, heaviest
 * first, at most `max`. Empty when nothing is in focus, which is what turns
 * the particles off.
 */
export function particleLinks(
  topology: Force3dTopology,
  active: string | null,
  max: number,
): readonly number[] {
  if (active === null) return [];
  const at = topology.index.get(active);
  if (at === undefined) return [];
  return [...(topology.incident[at] ?? [])]
    .toSorted(
      (a, b) => (topology.edges[b]?.weight ?? 0) - (topology.edges[a]?.weight ?? 0) || a - b,
    )
    .slice(0, max);
}
