/**
 * A value slot's keymap — chord to intent, as data (the pure half of
 * `ValueSlot`'s key handling).
 *
 * Every field value sits in one slot component, so these keys mean the same
 * thing on every type. Whose keys they are while the slot edits is the kind's
 * editor mode (`EDITOR_MODES[…].keys`): a caret editor leaves them to the
 * slot, a picker keeps them, because the same Enter and Escape move through
 * its candidates.
 */
import { lookupChord, type Chord, type KeyChordEvent } from "@/lib/keychord";

export type ValueSlotIntent =
  /** Keep what was typed and leave the editor. */
  | "commit"
  /** Put the value back and leave the editor. */
  | "cancel"
  /** The editing slot's key: nothing behind the slot may act on it. */
  | "contain";

export interface ValueSlotKeyState {
  readonly editing: boolean;
  /** Whose keys an editing slot's are (`EDITOR_MODES[…].keys`). */
  readonly keys: "slot" | "editor";
  /** An IME composition is in progress: its Enter confirms the composition. */
  readonly composing: boolean;
}

interface SlotBinding {
  readonly chord: Chord;
  readonly intent: ValueSlotIntent;
  /** The binding applies only while the slot owns its editor's keys. */
  readonly slotKeysOnly: boolean;
}

/** First match wins. Shift+Enter is a line break, not a commit. */
const EDITING_KEYS: readonly SlotBinding[] = [
  { chord: { key: "Enter", shift: false }, intent: "commit", slotKeysOnly: true },
  { chord: { key: "Escape" }, intent: "cancel", slotKeysOnly: true },
];

/** What `event` means to a slot in `state`, or null when the slot has no business with it. */
export function valueSlotIntent(
  event: KeyChordEvent,
  state: ValueSlotKeyState,
): ValueSlotIntent | null {
  if (!state.editing) return null;
  if (state.composing) return "contain";
  const match = lookupChord(
    event,
    EDITING_KEYS,
    (binding) => !binding.slotKeysOnly || state.keys === "slot",
  );
  return match?.intent ?? "contain";
}
