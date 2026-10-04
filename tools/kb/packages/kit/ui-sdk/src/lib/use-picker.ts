/**
 * A picker's highlight and keys — the half of the picker engine that moves.
 *
 * `pickerRows` (lib/picker) answers *what* a picker offers for a query; this
 * answers *how you move through it*. The query stays with whoever owns the
 * input: a field's picker holds it in state, the `[[` autocomplete derives it
 * from the node's text, the node palette from its own input. Passing it in is
 * what lets all of them read this one hook.
 */
import { useState } from "react";
import { lookupChord, type Chord, type KeyChordEvent } from "./keychord";
import type { PickerRow } from "./picker";

export interface PickerKeysInput {
  rows: readonly PickerRow[];
  /** The live search string, owned by the caller's input. */
  query: string;
  /** Enter (and Tab, when `pickOnTab`): the highlighted row, or null when there is none. */
  onPick: (row: PickerRow | null) => void;
  /** Escape. */
  onCancel: () => void;
  /** Backspace on an empty query: take back the last value picked. */
  onRemoveLast?: () => void;
  /** Tab picks too (the `[[` autocomplete completes on Tab). */
  pickOnTab?: boolean;
  /**
   * What else the list depends on beside the query — the node palette's
   * step. The highlight returns to the top when either changes.
   */
  scope?: string;
}

export interface PickerKeys {
  /** Index into `rows`; 0 whenever the query (or the scope) changes. */
  activeIndex: number;
  /** Move the highlight (a hovered row). */
  setActiveIndex: (index: number) => void;
  /** True when the key was claimed, so the caller knows not to fall through. */
  handleKeyDown: (event: KeyChordEvent & { preventDefault: () => void }) => boolean;
}

type PickerIntent = "next" | "previous" | "pick" | "cancel" | "removeLast";

interface PickerBinding {
  readonly chord: Chord;
  readonly intent: PickerIntent;
}

/**
 * First match wins. The movement rows are claimed only when there is a list
 * to move through, and the Tab and Backspace rows only when the caller asked
 * for them — otherwise the key is left to the input.
 */
const PICKER_KEYS: readonly PickerBinding[] = [
  { chord: { key: "ArrowDown" }, intent: "next" },
  { chord: { key: "ArrowUp" }, intent: "previous" },
  { chord: { key: "Enter" }, intent: "pick" },
  { chord: { key: "Tab" }, intent: "pick" },
  { chord: { key: "Escape" }, intent: "cancel" },
  { chord: { key: "Backspace", mod: false }, intent: "removeLast" },
];

export function usePickerKeys({
  rows,
  query,
  onPick,
  onCancel,
  onRemoveLast,
  pickOnTab = false,
  scope = "",
}: PickerKeysInput): PickerKeys {
  /**
   * The highlight, anchored to the query it was chosen under. A new query
   * means a new list, so the highlight returns to the top — derived here
   * rather than reset by an effect, which is also what lets the query be a
   * prop the caller owns.
   */
  const key = `${scope}\u0000${query}`;
  const [anchor, setAnchor] = useState({ key, index: 0 });
  const raw = anchor.key === key ? anchor.index : 0;
  const activeIndex = rows.length === 0 ? 0 : Math.min(raw, rows.length - 1);

  const moveTo = (index: number) => setAnchor({ key, index });
  const wrap = (delta: number) => moveTo((activeIndex + delta + rows.length) % rows.length);

  const APPLY: Readonly<Record<PickerIntent, () => void>> = {
    next: () => wrap(1),
    previous: () => wrap(-1),
    pick: () => onPick(rows[activeIndex] ?? null),
    cancel: onCancel,
    removeLast: () => onRemoveLast?.(),
  };

  const CLAIMS: Readonly<Record<PickerIntent, (pressed: string) => boolean>> = {
    next: () => rows.length > 0,
    previous: () => rows.length > 0,
    pick: (pressed) => pressed !== "Tab" || pickOnTab,
    cancel: () => true,
    removeLast: () => onRemoveLast !== undefined && query === "",
  };

  return {
    activeIndex,
    setActiveIndex: moveTo,
    handleKeyDown: (event) => {
      const match = lookupChord(event, PICKER_KEYS, (binding) => CLAIMS[binding.intent](event.key));
      if (!match) return false;
      event.preventDefault();
      APPLY[match.intent]();
      return true;
    },
  };
}
