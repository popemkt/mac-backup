import { present } from "./present.ts";
import type { KbNode, NodeId, RankedNode } from "./model.ts";

/**
 * Sibling ranks: variable-length base-36 fractions.
 *
 * A rank is a string over `0-9a-z` read as the digits after a radix point, so
 * `"i"` is 18/36 and `"i5"` sits just above it. Plain code-unit comparison of
 * two ranks is the numeric comparison of the fractions, provided no rank ends
 * in `0` — `"i"` and `"i0"` are the same number but different strings, and no
 * string lies strictly between them. So a trailing `0` is never produced, and
 * a bound that carries one (a legacy fixed-width key) is read without it.
 *
 * Because a rank can always grow by a digit, there is always a rank strictly
 * between two different ranks: nothing is ever "exhausted", and no insert has
 * to fall back to returning one of its bounds.
 */
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

function digit(char: string | undefined): number {
  return char === undefined ? 0 : DIGITS.indexOf(char);
}

function digitChar(value: number): string {
  return present(DIGITS[value], `rank digit ${value}`);
}

function trimZeros(rank: string): string {
  return rank.replace(/0+$/, "");
}

/**
 * A rank strictly between `low` and `high`, where `low < high` and `high`
 * does not end in `0`; `high` undefined means 1. The midpoint of the first
 * differing digit, descending a digit whenever the two are adjacent.
 */
function midpoint(low: string, high: string | undefined): string {
  if (high !== undefined) {
    let shared = 0;
    while ((low[shared] ?? "0") === high[shared]) shared++;
    if (shared > 0) return high.slice(0, shared) + midpoint(low.slice(shared), high.slice(shared));
  }
  const lowDigit = digit(low[0]);
  const highDigit = high === undefined ? BASE : digit(high[0]);
  if (highDigit - lowDigit > 1) return digitChar(Math.round((lowDigit + highDigit) / 2));
  // Adjacent digits. `high`'s first digit alone is below `high` when `high`
  // continues, and above `low`; otherwise keep `low`'s digit and go one deeper.
  if (high !== undefined && high.length > 1) return present(high[0], "rank head");
  return digitChar(lowDigit) + midpoint(low.slice(1), undefined);
}

/**
 * The next rank after `low` with nothing above it: bump the first digit that
 * can be bumped. Appends at the tail therefore *step* — `"i"`, `"j"`, `"k"` …
 * — and a rank gains a digit only once every digit before it is `z`, rather
 * than halving the remaining gap on every append.
 */
function stepAfter(low: string): string {
  for (let i = 0; i < low.length; i++) {
    const d = digit(low[i]);
    if (d < BASE - 1) return low.slice(0, i) + digitChar(d + 1);
  }
  return `${low}1`;
}

/** The mirror of {@link stepAfter} for a head insert below `high`. */
function stepBefore(high: string): string {
  for (let i = 0; i < high.length; i++) {
    const d = digit(high[i]);
    if (d === 0) continue;
    const stepped = high.slice(0, i) + digitChar(d - 1);
    return d - 1 === 0 ? `${stepped}z` : stepped;
  }
  throw new RangeError(`no rank below ${high}`);
}

/**
 * A rank strictly between `before` and `after`; either side may be open.
 *
 * Throws when the bounds leave no room — `before >= after`, or `after` being
 * `before` with trailing zeros. Callers choose bounds from a sibling group, so
 * a throw here is a defect in that choice, never a state to paper over by
 * returning a bound (which is what made two siblings share a rank).
 */
export function rankBetween(before?: string, after?: string): string {
  if (after === undefined) {
    return before === undefined ? digitChar(BASE / 2) : stepAfter(before);
  }
  const high = trimZeros(after);
  if (high === "" || (before !== undefined && before >= high)) {
    throw new RangeError(`no rank strictly between ${before ?? "(start)"} and ${after}`);
  }
  return before === undefined ? stepBefore(high) : midpoint(before, high);
}

/** Whether a rank can serve as the upper bound above `low` (open `low` = 0). */
function hasRoomAbove(low: string | undefined, high: string): boolean {
  const trimmed = trimZeros(high);
  return trimmed !== "" && (low === undefined || low < trimmed);
}

/**
 * Evenly spaced ranks for a sibling list, in its order. The width leaves at
 * least one full digit of room between neighbours, so a group of n siblings
 * is ranked with about `log36(n) + 1` characters.
 */
export function ranksFor(ids: readonly NodeId[]): Map<NodeId, string> {
  let width = 1;
  while (BASE ** width < ids.length + 1) width++;
  width += 1;
  const span = BASE ** width;
  const ranks = new Map<NodeId, string>();
  ids.forEach((id, index) => {
    const value = Math.floor(((index + 1) * span) / (ids.length + 1));
    ranks.set(id, trimZeros(value.toString(BASE).padStart(width, "0")));
  });
  return ranks;
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

/**
 * The visible order of the forest roots — the one sibling group with no
 * parent array to carry its order. Ranked roots come first, by code-unit
 * comparison of their ranks (never `localeCompare`: a rank is bytes, not
 * prose); two roots sharing a rank, and all unranked roots, fall back to id.
 * The store and every view sort roots with this one comparator.
 */
export function compareRootOrder(
  a: { readonly id: NodeId; readonly order?: string },
  b: { readonly id: NodeId; readonly order?: string },
): number {
  const ra = rankOf(a);
  const rb = rankOf(b);
  if (ra.ranked !== rb.ranked) return ra.ranked ? -1 : 1;
  if (ra.ranked && rb.ranked && ra.order !== rb.order) return ra.order < rb.order ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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
  orderedGroups.push(
    nodes
      .filter((node) => !children.has(node.id))
      .toSorted(compareRootOrder)
      .map((node) => node.id),
  );

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
    // the visible sequence of this group is unchanged. A stored neighbour that
    // leaves no room above the lower bound (a group whose ranks disagree with
    // its children array) is skipped rather than handed to `rankBetween`.
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
        if (storedAfter?.ranked === true && hasRoomAbove(before, storedAfter.order)) {
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
