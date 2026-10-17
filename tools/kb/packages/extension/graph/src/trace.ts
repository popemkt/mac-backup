/**
 * Trace: the k shortest simple paths between two nodes over the edge
 * projection (DESIGN.md → Trace and suggest). A path is not a datalog
 * relation, so this walks the projection rather than the index.
 *
 * The walk is over the undirected view and every hop keeps the edge it
 * crossed, so an explanation can read it either way. Cost is the number of
 * hops; a tie goes to the lower sum of `log(degree)` over the
 * intermediates, so a specific connector beats a hub. Yen's algorithm over a
 * Dijkstra on that pair gives the k paths, cheapest first.
 */
import type { LensEdge } from "./edges.ts";
import {
  adjacencyOf,
  degreeOf,
  neighboursOf,
  type Adjacency,
  type GraphProjection,
} from "./projection.ts";

/** One step of a path: the edge crossed from `from` to `to`, which may point either way. */
export interface TraceHop {
  readonly from: string;
  readonly to: string;
  readonly edge: LensEdge;
}

export interface TracePath {
  /** From the first node to the last, both ends included. */
  readonly nodes: readonly string[];
  readonly hops: readonly TraceHop[];
  /** The sum of `log(degree)` over the intermediates, the tie-break between paths of one length. */
  readonly hubCost: number;
}

/** Why a trace found nothing: one node at both ends, no path within the hops, or the visit cap before any path. */
export const TRACE_REASON_CODES = ["same-node", "unreached", "capped"] as const;

export interface TraceReason {
  readonly code: (typeof TRACE_REASON_CODES)[number];
  readonly message: string;
}

export interface TraceResult {
  readonly paths: readonly TracePath[];
  /** Set exactly when there are no paths. */
  readonly reason: TraceReason | null;
  /** What cut the walk short; the paths found before it still stand. */
  readonly warnings: readonly string[];
}

export interface TraceOptions {
  /** How many paths, at most. */
  readonly k?: number;
  /** The longest path, in hops. */
  readonly maxHops?: number;
  /** Walk through the scaffolding too; by default it is never an intermediate, as the graph elides it. */
  readonly includeSystem?: boolean;
  /** How many nodes the walk may settle in all before it stops with what it has. */
  readonly visitCap?: number;
}

export const TRACE_DEFAULTS = {
  k: 3,
  maxHops: 6,
  includeSystem: false,
  visitCap: 50_000,
} as const satisfies Required<TraceOptions>;

/** Hub costs closer than this are one cost, so summation order never reorders paths. */
const EPSILON = 1e-9;

export function trace(
  projection: Pick<GraphProjection, "edges" | "scaffolding">,
  from: string,
  to: string,
  options: TraceOptions = {},
): TraceResult {
  const opts = { ...TRACE_DEFAULTS, ...options };
  if (from === to) {
    return {
      paths: [],
      reason: { code: "same-node", message: `${from} is both ends` },
      warnings: [],
    };
  }
  const walk: Walk = {
    adjacency: adjacencyOf(projection.edges),
    scaffolding: projection.scaffolding,
    to,
    opts,
    visits: 0,
    capped: false,
  };
  const found = yen(walk, from);
  const warnings = walk.capped
    ? [`stopped after visiting ${opts.visitCap} nodes; these are the paths found so far`]
    : [];
  const paths = found.map((nodes) => pathOf(walk.adjacency, nodes));
  if (paths.length > 0) return { paths, reason: null, warnings };
  // A capped walk proves nothing about the rest of the graph, so it does not say "no path".
  const reason: TraceReason = walk.capped
    ? {
        code: "capped",
        message: `stopped after visiting ${opts.visitCap} nodes before finding a path from ${from} to ${to}`,
      }
    : {
        code: "unreached",
        message: `no path of at most ${opts.maxHops} hops joins ${from} to ${to}`,
      };
  return { paths, reason, warnings };
}

interface Walk {
  readonly adjacency: Adjacency;
  readonly scaffolding: ReadonlySet<string>;
  readonly to: string;
  readonly opts: Required<TraceOptions>;
  visits: number;
  capped: boolean;
}

interface Cost {
  readonly hops: number;
  readonly hub: number;
}

function compareCost(a: Cost, b: Cost): number {
  if (a.hops !== b.hops) return a.hops - b.hops;
  return Math.abs(a.hub - b.hub) > EPSILON ? a.hub - b.hub : 0;
}

function costOf(adjacency: Adjacency, nodes: readonly string[]): Cost {
  let hub = 0;
  for (const id of nodes.slice(1, -1)) hub += Math.log(degreeOf(adjacency, id));
  return { hops: nodes.length - 1, hub };
}

/** Cheapest first, then by the nodes walked, so equal costs always come out in one order. */
function comparePaths(adjacency: Adjacency, a: readonly string[], b: readonly string[]): number {
  return (
    compareCost(costOf(adjacency, a), costOf(adjacency, b)) ||
    a.join("\u0000").localeCompare(b.join("\u0000"))
  );
}

/** Yen's k shortest simple paths: each next path deviates from an earlier one at a spur node. */
function yen(walk: Walk, from: string): string[][] {
  const first = cheapest(walk, from, new Set(), new Set(), walk.opts.maxHops);
  if (first === null) return [];
  const accepted: string[][] = [first];
  const candidates: string[][] = [];
  const seen = new Set([key(first)]);
  while (accepted.length < walk.opts.k) {
    const previous = accepted.at(-1) ?? first;
    for (let i = 0; i < previous.length - 1; i++) {
      const root = previous.slice(0, i + 1);
      const spur = previous[i] ?? from;
      const blockedPairs = new Set<string>();
      for (const path of accepted) {
        const next = path[i + 1];
        if (next !== undefined && key(path.slice(0, i + 1)) === key(root))
          blockedPairs.add(pairKey(spur, next));
      }
      const blockedNodes = new Set(root.slice(0, -1));
      const tail = cheapest(walk, spur, blockedNodes, blockedPairs, walk.opts.maxHops - i);
      if (walk.capped) return accepted;
      if (tail === null) continue;
      const path = [...root.slice(0, -1), ...tail];
      if (seen.has(key(path))) continue;
      seen.add(key(path));
      candidates.push(path);
    }
    if (candidates.length === 0) break;
    candidates.sort((a, b) => comparePaths(walk.adjacency, a, b));
    const best = candidates.shift();
    if (best === undefined) break;
    accepted.push(best);
  }
  return accepted;
}

/**
 * The cheapest path from `start` to the walk's end within `hopLimit` hops,
 * avoiding `blockedNodes` and the pairs in `blockedPairs`; null when there is
 * none, or when the visit cap stopped the walk (`walk.capped`).
 */
function cheapest(
  walk: Walk,
  start: string,
  blockedNodes: ReadonlySet<string>,
  blockedPairs: ReadonlySet<string>,
  hopLimit: number,
): string[] | null {
  const best = new Map<string, Cost>([[start, { hops: 0, hub: 0 }]]);
  const previous = new Map<string, string>();
  const settled = new Set<string>();
  const queue = new Heap<{ id: string; cost: Cost }>(
    (a, b) => compareCost(a.cost, b.cost) || a.id.localeCompare(b.id),
  );
  queue.push({ id: start, cost: { hops: 0, hub: 0 } });
  for (let entry = queue.pop(); entry !== undefined; entry = queue.pop()) {
    const { id, cost } = entry;
    if (settled.has(id)) continue;
    settled.add(id);
    walk.visits += 1;
    if (walk.visits > walk.opts.visitCap) {
      walk.capped = true;
      return null;
    }
    if (id === walk.to) return unwind(previous, start, id);
    if (cost.hops >= hopLimit) continue;
    for (const next of neighboursOf(walk.adjacency, id)) {
      if (settled.has(next) || blockedNodes.has(next) || blockedPairs.has(pairKey(id, next)))
        continue;
      const isEnd = next === walk.to;
      if (!isEnd && !walk.opts.includeSystem && walk.scaffolding.has(next)) continue;
      const step: Cost = {
        hops: cost.hops + 1,
        hub: cost.hub + (isEnd ? 0 : Math.log(degreeOf(walk.adjacency, next))),
      };
      const known = best.get(next);
      if (known !== undefined && compareCost(step, known) >= 0) continue;
      best.set(next, step);
      previous.set(next, id);
      queue.push({ id: next, cost: step });
    }
  }
  return null;
}

function unwind(previous: ReadonlyMap<string, string>, start: string, end: string): string[] {
  const nodes = [end];
  for (let at = end; at !== start;) {
    const back = previous.get(at);
    if (back === undefined) break;
    nodes.push(back);
    at = back;
  }
  return nodes.toReversed();
}

/**
 * A walked node sequence as hops. Where several edges join a pair, the hop
 * names the most specific: a typed relation over a mention over
 * containment, an edge that points the way the path goes over one that
 * points back.
 */
function pathOf(adjacency: Adjacency, nodes: readonly string[]): TracePath {
  const hops: TraceHop[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const from = nodes[i];
    const to = nodes[i + 1];
    if (from === undefined || to === undefined) continue;
    const joining = adjacency.get(from)?.get(to) ?? [];
    const edge = joining.toSorted(
      (a, b) => edgeRank(a, from) - edgeRank(b, from) || a.kind.localeCompare(b.kind),
    )[0];
    if (edge !== undefined) hops.push({ from, to, edge });
  }
  return { nodes, hops, hubCost: costOf(adjacency, nodes).hub };
}

function edgeRank(edge: LensEdge, from: string): number {
  const kind = edge.kind.startsWith("prop:") ? 0 : edge.kind === "mention" ? 2 : 4;
  return kind + (edge.source === from ? 0 : 1);
}

function key(nodes: readonly string[]): string {
  return nodes.join("\u0000");
}

/** The undirected pair `a`–`b`, one key whichever end is named first. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** A binary min-heap under `compare`. */
class Heap<T> {
  readonly #items: T[] = [];
  readonly compare: (a: T, b: T) => number;
  constructor(compare: (a: T, b: T) => number) {
    this.compare = compare;
  }

  push(item: T): void {
    const items = this.#items;
    items.push(item);
    for (let i = items.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      const [child, up] = [items[i], items[parent]];
      if (child === undefined || up === undefined || this.compare(child, up) >= 0) break;
      items[i] = up;
      items[parent] = child;
      i = parent;
    }
  }

  pop(): T | undefined {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (items.length === 0 || last === undefined) return top;
    items[0] = last;
    for (let i = 0; ;) {
      const [l, r] = [2 * i + 1, 2 * i + 2];
      let least = i;
      const at = (n: number) => items[n];
      const lower = (a: number, b: number) => {
        const [x, y] = [at(a), at(b)];
        return x !== undefined && y !== undefined && this.compare(x, y) < 0;
      };
      if (l < items.length && lower(l, least)) least = l;
      if (r < items.length && lower(r, least)) least = r;
      if (least === i) break;
      const [a, b] = [items[i], items[least]];
      if (a === undefined || b === undefined) break;
      items[i] = b;
      items[least] = a;
      i = least;
    }
    return top;
  }
}
