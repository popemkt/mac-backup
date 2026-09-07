import { present } from "./present.ts";
import type { KbNode, NodeId, RankedNode } from "./model.ts";

const WIDTH = 10;
const BASE = 36n;
const MAX = BASE ** BigInt(WIDTH) - 1n;

function encode(value: bigint): string {
  return value.toString(36).padStart(WIDTH, "0");
}

function decode(value: string): bigint {
  let result = 0n;
  for (const char of value.slice(0, WIDTH)) {
    const digit = parseInt(char, 36);
    if (Number.isNaN(digit)) return 0n;
    result = result * BASE + BigInt(digit);
  }
  return result;
}

/**
 * Whether a node carries a sibling rank — the migration state, named.
 *
 * `""` is not a rank: an order key is present or absent, never
 * present-and-empty (DESIGN.md → Domain typing), which is what
 * `KbNodeSchema` now rejects on load. Collapsing the two spellings here is
 * what lets every reader ask one question instead of repeating a two-clause
 * test, and it is why {@link migrateOrderKeys} can promise a {@link RankedNode}.
 */
export type NodeRank =
  | { readonly ranked: true; readonly order: string }
  | { readonly ranked: false };

export function rankOf(node: { readonly order?: string } | undefined): NodeRank {
  const order = node?.order;
  return order === undefined || order === "" ? { ranked: false } : { ranked: true, order };
}

/** The same question as a narrowing, for code that keeps the node itself. */
export function isRanked(node: KbNode): node is RankedNode {
  return rankOf(node).ranked;
}

/** Stable rank for an existing sibling list; it deliberately preserves order. */
export function ranksFor(ids: readonly NodeId[]): Map<NodeId, string> {
  const ranks = new Map<NodeId, string>();
  const step = MAX / BigInt(ids.length + 1);
  ids.forEach((id, index) => ranks.set(id, encode(step * BigInt(index + 1))));
  return ranks;
}

export function rankBetween(before?: string, after?: string): string {
  const low = before !== undefined && before !== "" ? decode(before) : 0n;
  const high = after !== undefined && after !== "" ? decode(after) : MAX;
  if (high - low > 1n) return encode((low + high) / 2n);
  // Exhausting a rank gap is exceptionally rare at this width. Appending a
  // sortable suffix avoids moving existing siblings; a later maintenance pass
  // may compact ranks without changing their visible sequence.
  return `${before ?? encode(0n)}h`;
}

/**
 * One-time additive migration: give ranks to nodes that do not have one yet,
 * in today's visible child/root order.
 *
 * It must never rewrite a rank that already exists. This runs on every
 * `openKb`, and the first version recomputed evenly-spaced ranks for every
 * sibling group and overwrote whatever was stored. Child order survived that
 * (the group came from `node.children`, which is already the visible order),
 * but the forest-root group was rebuilt with `.sort()` on the id, so every
 * server start silently reverted root reordering to id order — defeating the
 * root-level move/insert this rank was added to enable.
 */
export function migrateOrderKeys(nodes: KbNode[]): { nodes: RankedNode[]; changed: boolean } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const orderedGroups: NodeId[][] = [];
  const children = new Set<NodeId>();
  for (const node of nodes) {
    orderedGroups.push(node.children.filter((id) => byId.has(id)));
    node.children.forEach((id) => children.add(id));
  }
  // Forest roots: respect any ranks already stored, and fall back to the id
  // sequence only for roots that have never been ranked.
  const rootIds = nodes
    .filter((node) => !children.has(node.id))
    .map((node) => node.id)
    .toSorted((a, b) => {
      const ra = rankOf(byId.get(a));
      const rb = rankOf(byId.get(b));
      if (ra.ranked && rb.ranked) return ra.order < rb.order ? -1 : ra.order > rb.order ? 1 : 0;
      if (ra.ranked) return -1;
      if (rb.ranked) return 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  orderedGroups.push(rootIds);

  const ranks = new Map<NodeId, string>();
  for (const ids of orderedGroups) {
    if (ids.length === 0) continue;
    const stored = ids.map((id) => rankOf(byId.get(id)));
    if (stored.every((rank) => rank.ranked)) continue; // fully ranked already — leave it alone
    if (!stored.some((rank) => rank.ranked)) {
      for (const [id, rank] of ranksFor(ids)) ranks.set(id, rank);
      continue;
    }
    // Mixed: rank only the gaps, between their already-ranked neighbours, so
    // the visible sequence of this group is unchanged.
    for (let i = 0; i < ids.length; i++) {
      const own = stored[i];
      if (own?.ranked === true) continue;
      let before: string | undefined;
      for (let j = i - 1; j >= 0; j--) {
        const neighbour = ids[j];
        if (neighbour === undefined) continue;
        const prior = stored[j];
        const rank = prior?.ranked === true ? prior.order : ranks.get(neighbour);
        if (rank !== undefined) {
          before = rank;
          break;
        }
      }
      let after: string | undefined;
      for (let j = i + 1; j < ids.length; j++) {
        const storedAfter = stored[j];
        if (storedAfter?.ranked === true) {
          after = storedAfter.order;
          break;
        }
      }
      const gapId = present(ids[i], "order gap id");
      ranks.set(gapId, rankBetween(before, after));
    }
  }

  let changed = false;
  const migrated = nodes.map((node): RankedNode => {
    if (isRanked(node)) return node; // never overwrite an existing rank
    changed = true;
    /*
     * Every node belongs to exactly one sibling group — its parent's children
     * or the forest root — and the loop above leaves every group fully ranked,
     * so an unranked node always has a rank waiting here. `present` states
     * that invariant instead of widening the result back to "maybe unranked",
     * which is the whole point of returning `RankedNode[]`.
     */
    return { ...node, order: present(ranks.get(node.id), `no sibling rank for ${node.id}`) };
  });
  return { nodes: migrated, changed };
}
