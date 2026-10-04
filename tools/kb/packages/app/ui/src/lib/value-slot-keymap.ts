/**
 * A value slot's keymap — chord to intent, as data (the pure half of
 * `ValueSlot`'s key handling).
 *
 * Every field value sits in one slot component, so these keys mean the same
 * thing on every type. A slot is keyed at rest (focused, its editor closed:
 * it moves, opens, removes, follows) and while it edits. Whose keys an
 * editing slot's are is the kind's editor mode (`EDITOR_MODES[…].keys`): a
 * caret editor leaves them to the slot, a picker or the date editor keeps
 * them, because the same Enter, Escape and arrows move through its own list.
 */
import { isPrintableKey, lookupChord, type Chord, type KeyChordEvent } from "@kb/ui-sdk";

export type ValueSlotIntent =
  // ── at rest ──
  /** Open the editor (for a toggle, flip it). */
  | "edit"
  /** Open the editor with this key as the first thing typed. */
  | "type"
  /** Take this value out of the field. */
  | "remove"
  /** Hand the keyboard back to the row the field belongs to. */
  | "leave"
  /** Move to the value before / after, or past the field to the row. */
  | "previous"
  | "next"
  // ── while editing ──
  /** Keep what was typed and leave the editor. */
  | "commit"
  /** Keep what was typed, and open the next value of a many-valued field. */
  | "commitAndAdd"
  /** Keep what was typed and move to the value before / after. */
  | "commitAndPrevious"
  | "commitAndNext"
  /** Put the value back and leave the editor. */
  | "cancel"
  /** Backspace in an emptied value: take it out, and land on the one before. */
  | "removeEmpty"
  /** A line break inside the value. */
  | "softBreak"
  // ── either ──
  /** Go where the value points (`ValueKindSpec.follow`). */
  | "follow"
  /** The editing slot's key: nothing behind the slot may act on it. */
  | "contain";

export interface ValueSlotKeyState {
  readonly editing: boolean;
  /** Whose keys an editing slot's are (`EDITOR_MODES[…].keys`). */
  readonly keys: "slot" | "editor";
  /** An IME composition is in progress: its Enter confirms the composition. */
  readonly composing: boolean;
  /** The value points somewhere (`ValueKindSpec.follow` is not null). */
  readonly canFollow: boolean;
  /** Activating the slot flips it (a checkbox): Space means edit. */
  readonly toggles: boolean;
  /**
   * Enter here adds the next value: the field holds many and the caret is at
   * the end of a text that is not empty. Read only when Enter is pressed.
   */
  readonly addsOnEnter: () => boolean;
  /** The caret is at the start / the end of the text being edited. */
  readonly caretAtStart: () => boolean;
  readonly caretAtEnd: () => boolean;
  /** The text being edited is empty. */
  readonly textEmpty: () => boolean;
}

interface SlotBinding {
  readonly chord: Chord;
  readonly intent: ValueSlotIntent;
}

/** What a binding needs of the slot beyond its chord, by intent. */
const NEEDS: Partial<Record<ValueSlotIntent, (state: ValueSlotKeyState) => boolean>> = {
  follow: (state) => state.canFollow,
  commitAndAdd: (state) => state.addsOnEnter(),
  removeEmpty: (state) => state.textEmpty(),
};

/** ⌘Enter follows the value, whether the slot is at rest or editing. */
const FOLLOW: SlotBinding = { chord: { key: "Enter", mod: true }, intent: "follow" };

/**
 * At rest, first match wins: the arrows and Tab move through the field's
 * values and on to the rows around them, Enter opens, a printable key starts
 * typing, Backspace or Delete takes the value out, and Escape goes back to
 * the row. A modified key is left alone (it is the app's).
 */
const REST_KEYS: readonly SlotBinding[] = [
  FOLLOW,
  { chord: { mod: true }, intent: "contain" },
  { chord: { key: "ArrowUp" }, intent: "previous" },
  { chord: { key: "ArrowDown" }, intent: "next" },
  { chord: { key: "Tab", shift: true }, intent: "previous" },
  { chord: { key: "Tab" }, intent: "next" },
  { chord: { key: ["Enter", "F2"] }, intent: "edit" },
  { chord: { key: ["Backspace", "Delete"] }, intent: "remove" },
  { chord: { key: "Escape" }, intent: "leave" },
];

/**
 * While a caret editor is open, first match wins. Shift+Enter is a line
 * break, not a commit; Enter at the end of a value of a many-valued field is
 * the outliner's "next item", so it adds one — and Enter on that new, empty
 * one closes it (the blank-commit rule), as Enter on an empty list item does.
 * Tab, and an arrow off the text's first or last character, keep the edit
 * and move on; Backspace in an emptied value takes it out.
 */
const EDITING_KEYS: readonly SlotBinding[] = [
  FOLLOW,
  { chord: { key: "Enter", shift: true, mod: false }, intent: "softBreak" },
  { chord: { key: "Enter", shift: false }, intent: "commitAndAdd" },
  { chord: { key: "Enter", shift: false }, intent: "commit" },
  { chord: { key: "Escape" }, intent: "cancel" },
  { chord: { key: "Tab", shift: true }, intent: "commitAndPrevious" },
  { chord: { key: "Tab" }, intent: "commitAndNext" },
  { chord: { key: "Backspace", mod: false }, intent: "removeEmpty" },
];

/** An arrow leaves a text only from its first or last character. */
function arrowOff(event: KeyChordEvent, state: ValueSlotKeyState): ValueSlotIntent | null {
  if (event.shiftKey === true || event.metaKey === true || event.ctrlKey === true) return null;
  if (event.key === "ArrowUp" && state.caretAtStart()) return "commitAndPrevious";
  if (event.key === "ArrowDown" && state.caretAtEnd()) return "commitAndNext";
  return null;
}

/** At rest: the slot's own keys, a toggle's Space, or a printable key to start typing. */
function restIntent(event: KeyChordEvent, state: ValueSlotKeyState): ValueSlotIntent | null {
  const accepts = (binding: SlotBinding) => NEEDS[binding.intent]?.(state) ?? true;
  const rest = lookupChord(event, REST_KEYS, accepts)?.intent;
  if (rest === "contain") return null;
  if (rest !== undefined) return rest;
  if (state.toggles && event.key === " ") return "edit";
  return isPrintableKey(event.key) && event.altKey !== true ? "type" : null;
}

/** What `event` means to a slot in `state`, or null when the slot has no business with it. */
export function valueSlotIntent(
  event: KeyChordEvent,
  state: ValueSlotKeyState,
): ValueSlotIntent | null {
  if (!state.editing) return restIntent(event, state);
  if (state.composing) return "contain";
  const accepts = (binding: SlotBinding) => NEEDS[binding.intent]?.(state) ?? true;
  // An editor that owns its keys (a picker, the date editor) moves through
  // its own list with them; only ⌘Enter is still the slot's.
  if (state.keys === "editor") return lookupChord(event, [FOLLOW], accepts)?.intent ?? "contain";
  return lookupChord(event, EDITING_KEYS, accepts)?.intent ?? arrowOff(event, state) ?? "contain";
}
