/**
 * What one field value *is* to the slot that shows it, as data.
 *
 * Every value of every field sits in one kind of slot (`ValueSlot`), and the
 * slot owns every gesture: focus, click routing, the keys. What a declared
 * type contributes is only the columns of its row here — which editor it
 * uses, how its value reads as text and back — so a new type is a row, and a
 * gesture is written once for all of them.
 *
 * Pure on purpose: no React, no DOM. The components that draw each kind are
 * keyed by the same union in `components/outline/field-value.tsx`.
 */
import type { FieldType } from "@/lib/field-type";
import { SYSTEM_IDS, type PropValue } from "@/lib/types";

/**
 * The kinds of value slot. A declared type names one; a field may name its
 * own (`sys.f.color` stores a hex string — text by type — and picks from
 * swatches).
 */
export type ValueKind = FieldType | "color";

/**
 * How a slot is edited.
 *
 * - `caret`: the value is text, and editing puts a caret in it.
 * - `calendar`: a date input replaces the display while editing.
 * - `picker`: a search over the field's allowed nodes replaces the display.
 * - `toggle`: there is nothing to edit; activating the slot flips the value.
 * - `swatch`: the editor is always shown; activating the slot does nothing.
 */
export type EditorMode = "caret" | "calendar" | "picker" | "toggle" | "swatch";

/** What a slot's own gestures do, per editor mode. */
interface EditorModeSpec {
  /**
   * The slot opens straight into its editor when the gesture that created it
   * asks (`autoOpen`). A caret slot does not: it is its own display.
   */
  readonly autoOpens: boolean;
  /** An unset slot is a Tab stop, and focusing it opens the editor. */
  readonly opensOnFocusWhenEmpty: boolean;
  /**
   * Whose keys these are while the slot edits. `slot`: the slot's keymap
   * (Enter commits, Escape reverts). `editor`: the editor's own — a picker
   * moves through its candidates with the same keys.
   */
  readonly keys: "slot" | "editor";
}

export const EDITOR_MODES: Readonly<Record<EditorMode, EditorModeSpec>> = {
  caret: { autoOpens: false, opensOnFocusWhenEmpty: false, keys: "slot" },
  calendar: { autoOpens: true, opensOnFocusWhenEmpty: false, keys: "editor" },
  picker: { autoOpens: true, opensOnFocusWhenEmpty: true, keys: "editor" },
  toggle: { autoOpens: false, opensOnFocusWhenEmpty: false, keys: "slot" },
  swatch: { autoOpens: false, opensOnFocusWhenEmpty: false, keys: "editor" },
};

export interface ValueKindSpec {
  readonly editor: EditorMode;
  /** The value as its editor's text. */
  readonly text: (value: PropValue) => string;
  /** The editor's text as a value, or null when the text is not one. */
  readonly parse: (text: string) => PropValue | null;
  /** The slot shows its placeholder rather than the value. */
  readonly isBlank: (value: PropValue) => boolean;
}

/** A scalar reads as unset when it holds its type's zero. */
function isBlankScalar(value: PropValue): boolean {
  return value.v === "" || value.v === 0 || value.v === false;
}

const asText = (value: PropValue): string => (value.t === "str" ? value.v : String(value.v));
const asString = (text: string): PropValue => ({ t: "str", v: text });

export const VALUE_KINDS: Readonly<Record<ValueKind, ValueKindSpec>> = {
  text: { editor: "caret", text: asText, parse: asString, isBlank: isBlankScalar },
  url: { editor: "caret", text: asText, parse: asString, isBlank: isBlankScalar },
  number: {
    editor: "caret",
    text: asText,
    parse: (text) => {
      const n = Number(text.trim());
      return Number.isNaN(n) ? null : { t: "num", v: n };
    },
    isBlank: (value) => value.t !== "num",
  },
  date: {
    editor: "calendar",
    text: (value) => (value.t === "str" || value.t === "date" ? value.v : ""),
    parse: asString,
    isBlank: (value) => !(value.t === "str" || value.t === "date") || value.v === "",
  },
  checkbox: {
    editor: "toggle",
    text: (value) => String(value.t === "bool" && value.v),
    parse: (text) => ({ t: "bool", v: text === "true" }),
    isBlank: (value) => value.t !== "bool" || !value.v,
  },
  ref: {
    editor: "picker",
    text: (value) => (value.t === "ref" ? value.v : ""),
    parse: (text) => ({ t: "ref", v: text }),
    isBlank: (value) => value.t !== "ref" || value.v === "",
  },
  color: { editor: "swatch", text: asText, parse: asString, isBlank: isBlankScalar },
};

/**
 * Fields that name their own kind, whatever type they declare. One row here
 * replaces the three `if (fieldId === SYSTEM_IDS.colorField)` this once was.
 */
const FIELD_ID_KINDS: Readonly<Record<string, ValueKind>> = {
  [SYSTEM_IDS.colorField]: "color",
};

/** The kind of slot a field's values sit in: its own if it names one, else its type's. */
export function valueKindOf(fieldType: FieldType, fieldId?: string): ValueKind {
  const named = fieldId === undefined ? undefined : FIELD_ID_KINDS[fieldId];
  return named ?? fieldType;
}

/**
 * The value a toggle slot's activation writes. A checkbox reads as off for
 * anything that is not a true bool, so activating it writes `true`.
 */
export function toggledValue(value: PropValue): PropValue {
  return { t: "bool", v: !(value.t === "bool" && value.v) };
}
