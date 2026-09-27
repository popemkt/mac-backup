/**
 * The picker engine: choosing nodes from a candidate set by typing.
 *
 * Every place kb asks "which node?" is this one gesture over a different
 * candidate set — a ref or options field value, a `[[` reference in text, a
 * tag or a field to add, a node to reference, an ontology's include/extends
 * lists, a node to place on a canvas. They differ only in where candidates
 * come from, whether a new one may be minted, and what a pick writes. So the
 * matching, the ranking, the create row and the keys are stated once, here
 * and in `use-picker.ts`, and the one list (`components/ui/picker-list`)
 * draws the result. A surface that needs a picker supplies candidates and a
 * write; it never ranks or handles an arrow key itself.
 *
 * Pure: no React, no DOM.
 */

/** One node a picker may offer, as the picker sees it. */
export interface PickerCandidate {
  readonly id: string;
  /** What the row shows and what a query is matched against. */
  readonly label: string;
  /** Muted text after the label (e.g. "already extends"). */
  readonly note?: string;
  /** Shown, but not pickable. */
  readonly disabled?: boolean;
}

/** A half-open `[from, to)` range of a label that the query matched. */
export type MatchRange = readonly [number, number];

/** The id of the row that mints a node from the query. Never a node id. */
export const CREATE_ROW_ID = "\u0000create";

export type PickerRow =
  | {
      readonly kind: "item";
      readonly id: string;
      readonly label: string;
      readonly note?: string;
      readonly disabled: boolean;
      /** Where the query landed in `label`, for highlighting. */
      readonly matches: readonly MatchRange[];
      /** Already a value of the field being picked for. */
      readonly selected: boolean;
    }
  | {
      readonly kind: "create";
      readonly id: typeof CREATE_ROW_ID;
      /** The name the new node gets: the query, trimmed. */
      readonly name: string;
    };

export interface PickerQuery {
  readonly query: string;
  /** Ids already picked; their rows are marked, and stay pickable (a toggle). */
  readonly selected?: ReadonlySet<string>;
  /**
   * Offer to mint a node named by the query, as the last row, when the query
   * names no candidate exactly.
   */
  readonly canCreate?: boolean;
  /** At most this many item rows (the create row is extra). */
  readonly limit?: number;
}

interface Match {
  /** Lower is better. */
  readonly score: number;
  readonly ranges: readonly MatchRange[];
}

/** Merge adjacent single-character ranges into runs. */
function runs(indices: readonly number[]): MatchRange[] {
  const out: Array<[number, number]> = [];
  for (const i of indices) {
    const last = out.at(-1);
    if (last !== undefined && last[1] === i) last[1] = i + 1;
    else out.push([i, i + 1]);
  }
  return out;
}

/** Where `q` occurs in `hay` as a subsequence, or null. */
function subsequence(hay: string, q: string): number[] | null {
  const at: number[] = [];
  let i = 0;
  for (let h = 0; h < hay.length && i < q.length; h++) {
    if (hay[h] === q[i]) {
      at.push(h);
      i += 1;
    }
  }
  return i === q.length ? at : null;
}

/**
 * How well `query` matches a candidate, or null when it does not.
 *
 * In order: the label starts with the query, contains it, the id contains it,
 * or the query's characters occur in order in the label (then in the label
 * and id together). Only label matches carry ranges, since only the label is
 * shown.
 */
export function matchCandidate(label: string, id: string, query: string): Match | null {
  const q = query.trim().toLowerCase();
  if (q === "") return { score: 0, ranges: [] };
  const text = label.toLowerCase();
  const at = text.indexOf(q);
  if (at === 0) return { score: 0, ranges: [[0, q.length]] };
  if (at > 0) return { score: 1, ranges: [[at, at + q.length]] };
  if (id.toLowerCase().includes(q)) return { score: 2, ranges: [] };
  const inLabel = subsequence(text, q);
  if (inLabel !== null) return { score: 3, ranges: runs(inLabel) };
  if (subsequence(`${text} ${id.toLowerCase()}`, q) !== null) return { score: 3, ranges: [] };
  return null;
}

/**
 * The rows a picker shows for a query: the matching candidates, best first,
 * then the create row when minting is allowed and nothing is named exactly.
 */
export function pickerRows(
  candidates: readonly PickerCandidate[],
  { query, selected, canCreate = false, limit = Number.POSITIVE_INFINITY }: PickerQuery,
): PickerRow[] {
  const scored: Array<{ candidate: PickerCandidate; match: Match }> = [];
  for (const candidate of candidates) {
    const match = matchCandidate(candidate.label, candidate.id, query);
    if (match !== null) scored.push({ candidate, match });
  }
  // Stable, so candidates that match equally well keep the order their
  // source gave them (a label order, a command order, an option order).
  scored.sort((a, b) => a.match.score - b.match.score);
  const rows: PickerRow[] = scored.slice(0, limit).map(({ candidate, match }) => ({
    kind: "item",
    id: candidate.id,
    label: candidate.label,
    ...(candidate.note === undefined ? {} : { note: candidate.note }),
    disabled: candidate.disabled === true,
    matches: match.ranges,
    selected: selected?.has(candidate.id) === true,
  }));
  const name = query.trim();
  const named = candidates.some((c) => c.label.trim().toLowerCase() === name.toLowerCase());
  if (canCreate && name !== "" && !named) rows.push({ kind: "create", id: CREATE_ROW_ID, name });
  return rows;
}

/**
 * Split a label into the runs a query matched and the runs it did not, for
 * the list to highlight.
 */
export function labelRuns(
  label: string,
  matches: readonly MatchRange[],
): Array<{ text: string; matched: boolean; from: number }> {
  const out: Array<{ text: string; matched: boolean; from: number }> = [];
  let at = 0;
  for (const [from, to] of matches) {
    if (from > at) out.push({ text: label.slice(at, from), matched: false, from: at });
    out.push({ text: label.slice(from, to), matched: true, from });
    at = to;
  }
  if (at < label.length) out.push({ text: label.slice(at), matched: false, from: at });
  return out;
}

/** What orders a picker's candidates before a query does. */
export interface CandidateOrder {
  /** A declared order (a field's own options, in outline order): it wins outright. */
  readonly declared?: readonly string[];
  /** Picked lately, most recent first. */
  readonly recent?: readonly string[];
  /** How many times each candidate is already used where this picker writes. */
  readonly uses?: ReadonlyMap<string, number>;
}

/**
 * Candidates in the order a picker offers them with nothing typed: a declared
 * order when there is one — an option list is curated, and reordering a
 * status list by use would scramble it — otherwise the recently picked
 * first, then the most used, then the source's own order. A query then ranks
 * by match (`pickerRows`), stable, so this order breaks its ties.
 */
export function orderCandidates(
  candidates: readonly PickerCandidate[],
  { declared, recent = [], uses }: CandidateOrder,
): PickerCandidate[] {
  if (declared !== undefined) {
    const place = new Map(declared.map((id, i) => [id, i]));
    const at = (c: PickerCandidate) => place.get(c.id) ?? Number.POSITIVE_INFINITY;
    return candidates.toSorted((a, b) => at(a) - at(b));
  }
  const lately = new Map(recent.map((id, i) => [id, i]));
  const rank = (c: PickerCandidate) => lately.get(c.id) ?? Number.POSITIVE_INFINITY;
  const used = (c: PickerCandidate) => uses?.get(c.id) ?? 0;
  return candidates.toSorted((a, b) => rank(a) - rank(b) || used(b) - used(a));
}
