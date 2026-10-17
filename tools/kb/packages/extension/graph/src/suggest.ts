/**
 * Suggest: for one node, the nodes the chosen kinds do not connect to it but
 * whose structure says they are related (DESIGN.md → Trace and suggest).
 *
 * A candidate is two hops away and not one. Its score adds three structural
 * signals, each never negative, so a candidate's score never falls as its
 * evidence grows:
 * - Adamic-Adar over the neighbours the two share, Σ 1/log(deg z);
 * - the tags they share, each weighted by its rarity (idf);
 * - co-citation, a shared neighbour that points at both, Σ 1/log(1 + out z).
 */
import {
  adjacencyOf,
  degreeOf,
  neighboursOf,
  type Adjacency,
  type GraphProjection,
} from "./projection.ts";

/** Why a candidate is suggested: the evidence behind its score. */
export interface SuggestReasons {
  /** Neighbours the two share, not counting a shared tag. */
  readonly shared: readonly string[];
  /** Tags the two share. */
  readonly tags: readonly string[];
  /** Shared neighbours that point at both. */
  readonly citedBy: readonly string[];
}

export interface Suggestion {
  readonly id: string;
  readonly score: number;
  readonly reasons: SuggestReasons;
}

export interface SuggestOptions {
  readonly limit?: number;
}

export const SUGGEST_DEFAULTS = {
  limit: 10,
} as const satisfies Required<SuggestOptions>;

/** The best-scored candidates for `id`, highest first and then by id, so the order is deterministic. */
export function suggest(
  projection: GraphProjection,
  id: string,
  options: SuggestOptions = {},
): Suggestion[] {
  const opts = { ...SUGGEST_DEFAULTS, ...options };
  const adjacency = adjacencyOf(projection.edges);
  const arrows = arrowsOf(projection.edges);
  const idf = rarityOf(projection.tags);
  const evidence = evidenceFor(projection, adjacency, arrows, id);
  const ownTags = new Set(projection.tags.get(id) ?? []);
  const scored: Suggestion[] = [];
  for (const [candidate, entry] of evidence) {
    const tags = (projection.tags.get(candidate) ?? [])
      .filter((tag) => ownTags.has(tag))
      .toSorted();
    const score =
      sum(entry.shared, (z) => 1 / Math.log(degreeOf(adjacency, z))) +
      sum(tags, idf) +
      sum(entry.citedBy, (z) => 1 / Math.log(1 + arrows.outDegree(z)));
    scored.push({ id: candidate, score, reasons: { ...entry, tags } });
  }
  return scored
    .toSorted((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, opts.limit);
}

/**
 * The candidates two hops from `id`, with the neighbours that bring each one
 * there: a shared tag is scored as a tag, not again as a neighbour.
 */
function evidenceFor(
  projection: GraphProjection,
  adjacency: Adjacency,
  arrows: Arrows,
  id: string,
): Map<string, { shared: string[]; citedBy: string[] }> {
  const ownTags = new Set(projection.tags.get(id) ?? []);
  const direct = new Set(neighboursOf(adjacency, id));
  const evidence = new Map<string, { shared: string[]; citedBy: string[] }>();
  for (const z of direct) {
    for (const candidate of neighboursOf(adjacency, z)) {
      if (candidate === id || direct.has(candidate)) continue;
      const entry = evidence.get(candidate) ?? { shared: [], citedBy: [] };
      evidence.set(candidate, entry);
      const isSharedTag = ownTags.has(z) && (projection.tags.get(candidate) ?? []).includes(z);
      if (!isSharedTag) entry.shared.push(z);
      if (arrows.pointsAt(z, id) && arrows.pointsAt(z, candidate)) entry.citedBy.push(z);
    }
  }
  return evidence;
}

/** The projection's edges as arrows, one per ordered pair whatever its kinds. */
interface Arrows {
  readonly pointsAt: (from: string, to: string) => boolean;
  readonly outDegree: (id: string) => number;
}

function arrowsOf(edges: GraphProjection["edges"]): Arrows {
  const out = new Map<string, Set<string>>();
  for (const edge of edges) {
    const targets = out.get(edge.source) ?? new Set<string>();
    out.set(edge.source, targets.add(edge.target));
  }
  return {
    pointsAt: (from, to) => out.get(from)?.has(to) === true,
    outDegree: (id) => out.get(id)?.size ?? 1,
  };
}

/** A tag's weight by its rarity among the tagged nodes: log(1 + tagged / carrying it). */
function rarityOf(tags: GraphProjection["tags"]): (tag: string) => number {
  const frequency = new Map<string, number>();
  for (const own of tags.values())
    for (const tag of own) frequency.set(tag, (frequency.get(tag) ?? 0) + 1);
  return (tag) => Math.log(1 + tags.size / (frequency.get(tag) ?? 1));
}

function sum<T>(items: readonly T[], weight: (item: T) => number): number {
  return items.reduce((total, item) => total + weight(item), 0);
}
