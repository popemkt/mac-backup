/**
 * Candidate search and its keyboard navigation, for every ref picker.
 *
 * `fuzzyNodeCandidates` (lib/refs) answers *which* nodes a picker may offer;
 * this answers *how you move through them*. The two questions were one
 * component before — the typed ref field editor computed candidates, tracked
 * the highlighted index, handled four keys and rendered, all in one function,
 * so the part with real rules could only be tested through the DOM.
 *
 * The query stays with whoever owns the input: a ref field editor holds it in
 * state, and the `[[` autocomplete derives it from the node's text. Passing it
 * in is what lets both read this one hook instead of two.
 */
import { useMemo, useState } from "react";
import { lookupChord, type Chord, type KeyChordEvent } from "@/lib/keychord";
import { fuzzyNodeCandidates, type RefCandidate } from "@/lib/refs";
import type { NodeMap } from "@/lib/types";

export interface RefCandidatesInput {
  nodes: NodeMap;
  /** The live search string, owned by the caller's input. */
  query: string;
  /** The field's declared targets, or null for unconstrained search. */
  allowed?: Set<string> | null;
  /** Enter: the highlighted candidate, or null when nothing matched. */
  onPick: (candidate: RefCandidate | null) => void;
  /** Escape. */
  onCancel: () => void;
}

export interface RefCandidates {
  candidates: RefCandidate[];
  /** Index into {@link candidates}; 0 whenever the query changes. */
  activeIndex: number;
  /** True when the key was claimed, so the caller knows not to fall through. */
  handleKeyDown: (event: KeyChordEvent & { preventDefault: () => void }) => boolean;
}

/** What a key press does to the candidate list. */
type CandidateIntent = "next" | "previous" | "pick" | "cancel";

/**
 * First match wins, exactly as the `if` chain this replaces resolved. The two
 * arrow rows are claimed only when there is a list to move through — an empty
 * list leaves the arrows to the browser, which is what the chain's
 * `candidates.length > 0` guard did.
 */
const CANDIDATE_KEYS: ReadonlyArray<{ chord: Chord; intent: CandidateIntent }> = [
  { chord: { key: "ArrowDown" }, intent: "next" },
  { chord: { key: "ArrowUp" }, intent: "previous" },
  { chord: { key: "Enter" }, intent: "pick" },
  { chord: { key: "Escape" }, intent: "cancel" },
];

const NEEDS_CANDIDATES: Readonly<Record<CandidateIntent, boolean>> = {
  next: true,
  previous: true,
  pick: false,
  cancel: false,
};

export function useRefCandidates({
  nodes,
  query,
  allowed = null,
  onPick,
  onCancel,
}: RefCandidatesInput): RefCandidates {
  const candidates = useMemo(
    () => fuzzyNodeCandidates(nodes, query, { allowed }),
    [nodes, query, allowed],
  );

  /**
   * The highlight, anchored to the query it was chosen under. A new query
   * means a new list, so the highlight returns to the top — derived here
   * rather than reset by an effect, which is also what lets the query be a
   * prop the caller owns.
   */
  const [anchor, setAnchor] = useState({ query, index: 0 });
  const activeIndex = anchor.query === query ? anchor.index : 0;

  function move(delta: number): void {
    setAnchor({
      query,
      index: (activeIndex + delta + candidates.length) % candidates.length,
    });
  }

  const APPLY: Readonly<Record<CandidateIntent, () => void>> = {
    next: () => move(1),
    previous: () => move(-1),
    pick: () => onPick(candidates[activeIndex] ?? candidates[0] ?? null),
    cancel: onCancel,
  };

  return {
    candidates,
    activeIndex,
    handleKeyDown: (event) => {
      const match = lookupChord(
        event,
        CANDIDATE_KEYS,
        (row) => !NEEDS_CANDIDATES[row.intent] || candidates.length > 0,
      );
      if (!match) return false;
      event.preventDefault();
      APPLY[match.intent]();
      return true;
    },
  };
}
