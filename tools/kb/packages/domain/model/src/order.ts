import { present } from "./present.ts";
import type { KbNode, NodeId } from "./model.ts";
import { applyTx, type StoreTx } from "./tx.ts";

/**
 * Sibling ranks: variable-length base-36 fractions (DESIGN.md → Sibling
 * ranks). This module is the one owner of ranking; the create and move
 * operations, the store's commit, the merge and the UI all go through it.
 *
 * A rank is a string over `0-9a-z` read as the digits after a radix point, so
 * `"i"` is 18/36 and `"i5"` sits just above it. Plain code-unit comparison of
 * two ranks is the numeric comparison of the fractions, provided no rank ends
 * in `0` — `"i"` and `"i0"` are the same number but different strings, and no
 * string lies strictly between them. So a trailing `0` is never produced, and
 * a bound that carries one (a legacy fixed-width key) is read without it.
 *
 * Because a rank can always grow by a character, there is always a rank
 * strictly between two different ranks: nothing is ever "exhausted", and no
 * insert has to fall back to returning one of its bounds.
 */
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

/**
 * The longest rank a well-ranked group holds. Bisecting one gap over and over
 * grows a rank by about one character per five inserts; a group whose ranks
 * pass this is re-spread when it is next committed, so ranks stay short
 * without a maintenance pass anybody has to remember to run.
 */
const MAX_RANK_LENGTH = 12;

const WELL_FORMED = /^[0-9a-z]*[1-9a-z]$/;

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
 * — and a rank gains a character only once every digit before it is `z`,
 * rather than halving the remaining gap on every append.
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
 * returning a bound (which is what once made two siblings share a rank).
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
 * Whether a node carries a sibling rank.
 *
 * `""` is not a rank: an order key is present or absent, never
 * present-and-empty (DESIGN.md → Domain typing), which is what `KbNodeSchema`
 * rejects on load. Collapsing the two spellings here is what lets every
 * reader ask one question instead of repeating a two-clause test.
 */
export type NodeRank =
  | { readonly ranked: true; readonly order: string }
  | { readonly ranked: false };

export function rankOf(node: { readonly order?: string } | undefined): NodeRank {
  const order = node?.order;
  return order === undefined || order === "" ? { ranked: false } : { ranked: true, order };
}

/** What ranking needs to know about a sibling: who it is and its stored rank. */
export interface RankSlot {
  readonly id: NodeId;
  readonly order?: string | undefined;
}

/** A rank this module could have written: well formed, and short enough to keep. */
function usableRank(slot: RankSlot | undefined): string | undefined {
  const rank = rankOf(slot);
  return rank.ranked && WELL_FORMED.test(rank.order) && rank.order.length <= MAX_RANK_LENGTH
    ? rank.order
    : undefined;
}

/**
 * The visible order of the forest roots — the one sibling group with no
 * parent array to carry its order. Ranked roots come first, by code-unit
 * comparison of their ranks (never `localeCompare`: a rank is bytes, not
 * prose); two roots sharing a rank, and all unranked roots, fall back to id.
 * The store and every view sort roots with this one comparator.
 */
export function compareRootOrder(a: RankSlot, b: RankSlot): number {
  const ra = rankOf(a);
  const rb = rankOf(b);
  if (ra.ranked !== rb.ranked) return ra.ranked ? -1 : 1;
  if (ra.ranked && rb.ranked && ra.order !== rb.order) return ra.order < rb.order ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The first usable rank at or after `from` that leaves room above `low`. */
function upperBound(
  siblings: readonly RankSlot[],
  from: number,
  low: string | undefined,
): string | undefined {
  for (let i = from; i < siblings.length; i++) {
    const rank = usableRank(siblings[i]);
    if (rank !== undefined && (low === undefined || low < rank)) return rank;
  }
  return undefined;
}

/**
 * The rank for a node placed at `position` in a sibling group.
 *
 * `siblings` is the group in visible order *without* the placed node, so
 * `position` is the index it will have — the same number `node.add` and
 * `node.update` take. A node that already has a rank keeps it when it still
 * fits between its new neighbours, so re-placing a node where it already is
 * writes nothing; otherwise the rank is derived from the nearest usable
 * neighbours. A neighbour group that is itself out of order is the commit's
 * to repair ({@link rankTx}), not this function's.
 */
export function rankForInsert(
  siblings: readonly RankSlot[],
  position: number,
  current?: string,
): string {
  const at = Math.max(0, Math.min(position, siblings.length));
  let low: string | undefined;
  for (let i = at - 1; i >= 0 && low === undefined; i--) low = usableRank(siblings[i]);
  const next = upperBound(siblings, at, undefined);
  const own = usableRank({ id: "", order: current });
  if (own !== undefined && (low === undefined || low < own) && (next === undefined || own < next)) {
    return own;
  }
  return rankBetween(low, upperBound(siblings, at, low));
}

/**
 * The ranks that make one sibling group well ranked: every member ranked,
 * with a usable rank, strictly increasing along the visible order. Only the
 * members whose rank changes are returned.
 *
 * Members are kept greedily — a rank above the last kept one stays — and the
 * rest are placed between their neighbours, so duplicates, ties after a merge
 * and a group whose ranks disagree with its children array are repaired with
 * the fewest writes. A group holding a rank no one could have written (too
 * long, malformed) is re-spread whole, which is also what keeps ranks short.
 */
function repairGroup(members: readonly RankSlot[]): Map<NodeId, string> {
  const respread = (): Map<NodeId, string> => {
    const spread = ranksFor(members.map((m) => m.id));
    for (const m of members) if (spread.get(m.id) === m.order) spread.delete(m.id);
    return spread;
  };
  if (members.some((m) => rankOf(m).ranked && usableRank(m) === undefined)) return respread();
  const out = new Map<NodeId, string>();
  let low: string | undefined;
  for (let i = 0; i < members.length; i++) {
    const member = present(members[i], "group member");
    const own = usableRank(member);
    if (own !== undefined && (low === undefined || low < own)) {
      low = own;
      continue;
    }
    const rank = rankBetween(low, upperBound(members, i + 1, low));
    if (rank.length > MAX_RANK_LENGTH) return respread();
    out.set(member.id, rank);
    low = rank;
  }
  return out;
}

/**
 * `tx` as it commits: its upserts, plus whatever rank repairs the sibling
 * groups it touches need, so that every group a commit writes to is well
 * ranked in the state it lands in.
 *
 * Every store adapter runs this inside its own exclusion, against the state
 * it is about to merge into. That is what makes the rank of a node created
 * without one — or two siblings appended concurrently from the same stale
 * read — the store's to settle, once, rather than each writer's guess. A
 * group is touched when the tx upserts one of its members, or the parent
 * whose children array it is. Untouched groups are left exactly as stored.
 */
export function rankTx(previous: readonly KbNode[], tx: StoreTx): StoreTx {
  if (tx.upserts.length === 0) return tx;
  const next = applyTx(previous, tx);
  const parentOf = new Map<NodeId, NodeId>();
  for (const node of next.values()) for (const child of node.children) parentOf.set(child, node.id);

  const groups = new Set<NodeId | null>();
  for (const node of tx.upserts) {
    groups.add(parentOf.get(node.id) ?? null);
    if (node.children.length > 0) groups.add(node.id);
  }

  const ranks = new Map<NodeId, string>();
  for (const parent of groups) {
    const members =
      parent === null
        ? [...next.values()].filter((n) => !parentOf.has(n.id)).toSorted(compareRootOrder)
        : (next.get(parent)?.children ?? []).flatMap((id) => {
            const member = next.get(id);
            return member === undefined ? [] : [member];
          });
    for (const [id, rank] of repairGroup(members)) ranks.set(id, rank);
  }
  if (ranks.size === 0) return tx;

  const upserts = tx.upserts.map((node) => {
    const rank = ranks.get(node.id);
    return rank === undefined ? node : { ...node, order: rank };
  });
  const written = new Set(upserts.map((node) => node.id));
  for (const [id, rank] of ranks) {
    const node = next.get(id);
    if (node !== undefined && !written.has(id)) upserts.push({ ...node, order: rank });
  }
  return { upserts, deletes: tx.deletes };
}

/**
 * A sibling group in visible order — a parent's children, or the forest
 * roots — optionally without one member. The group a node joins, without the
 * node, is what a `position` indexes, on the server and in the UI alike.
 */
export function siblingSlots<N extends RankSlot & { readonly children: readonly NodeId[] }>(
  nodes: Iterable<N>,
  parent: NodeId | null,
  excluding?: NodeId,
): N[] {
  const all = [...nodes];
  if (parent !== null) {
    const byId = new Map(all.map((n) => [n.id, n]));
    return (byId.get(parent)?.children ?? []).flatMap((id) => {
      const member = byId.get(id);
      return member === undefined || id === excluding ? [] : [member];
    });
  }
  const children = new Set(all.flatMap((n) => n.children));
  return all.filter((n) => !children.has(n.id) && n.id !== excluding).toSorted(compareRootOrder);
}
