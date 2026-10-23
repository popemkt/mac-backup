// Key strokes and their vim-style notation. The one parser every key binding
// goes through: bare keys (`j`, `gg`), chords (`<A-f>`), and the letters of a
// hint label alike.
//
// Notation: a printable character stands for itself (`G` is shift+g, `?` is
// shift+/). `<...>` names a special key or a chord: `<Esc>`, `<Space>`,
// `<lt>` (a literal `<`), `<C-d>`, `<A-S-f>`, `<M-k>`. Modifiers: `C` control,
// `A` alt/option, `M` meta/command, `S` shift. Shift is only kept for named
// keys; for a printable character it is already in the character.
import { Result, Schema } from "effect";

export interface KeyStroke {
  /** A single printable character, or a named key such as `Escape`. */
  readonly key: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  /** Only meaningful for named keys (`<S-Tab>`); false for characters. */
  readonly shift: boolean;
}

export class KeySequenceError extends Schema.TaggedError<KeySequenceError>()("KeySequenceError", {
  input: Schema.String,
  message: Schema.String,
}) {}

/** `<name>` spellings, lowercased, to the `KeyboardEvent.key` they mean. */
const NAMED_KEYS: Readonly<Record<string, string>> = {
  esc: "Escape",
  escape: "Escape",
  cr: "Enter",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  space: " ",
  bs: "Backspace",
  backspace: "Backspace",
  del: "Delete",
  delete: "Delete",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  lt: "<",
  gt: ">",
  bar: "|",
  bslash: "\\",
};

/** The way a named key is written back in notation. */
const NOTATION_NAMES: Readonly<Record<string, string>> = {
  Escape: "Esc",
  Enter: "CR",
  Tab: "Tab",
  " ": "Space",
  Backspace: "BS",
  Delete: "Del",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  "<": "lt",
};

const FUNCTION_KEY = /^f([1-9]|1[0-9]|2[0-4])$/u;

/** Whether `key` is one printable character (a code point, not a name). */
export function isCharacterKey(key: string): boolean {
  return [...key].length === 1 && key !== " ";
}

export function stroke(key: string, modifiers: Partial<Omit<KeyStroke, "key">> = {}): KeyStroke {
  const character = isCharacterKey(key);
  return {
    key,
    ctrl: modifiers.ctrl ?? false,
    alt: modifiers.alt ?? false,
    meta: modifiers.meta ?? false,
    shift: character ? false : (modifiers.shift ?? false),
  };
}

/** Whether a stroke carries a command modifier (control, alt or meta). */
export function isChord(value: KeyStroke): boolean {
  return value.ctrl || value.alt || value.meta;
}

/**
 * The canonical identity of a stroke. Two strokes are the same binding exactly
 * when their ids are equal, so a matcher keys its trie by it.
 */
export function strokeId(value: KeyStroke): string {
  const named = NOTATION_NAMES[value.key];
  const body = isCharacterKey(value.key) && value.key !== "<" ? value.key : (named ?? value.key);
  const prefix = `${value.ctrl ? "C-" : ""}${value.alt ? "A-" : ""}${value.meta ? "M-" : ""}${value.shift ? "S-" : ""}`;
  if (prefix === "" && isCharacterKey(value.key) && value.key !== "<") return body;
  return `<${prefix}${body}>`;
}

export function formatSequence(sequence: ReadonlyArray<KeyStroke>): string {
  return sequence.map(strokeId).join("");
}

function parseBracket(input: string, inner: string): Result.Result<KeyStroke, KeySequenceError> {
  const parts = inner.split("-");
  // `<C-->` is control and the minus key: an empty last part means "-".
  const minus = parts.length >= 3 && parts.at(-1) === "" && parts.at(-2) === "";
  const rawName = minus ? "-" : (parts.at(-1) ?? "");
  const modifierParts = minus ? parts.slice(0, -2) : parts.slice(0, -1);
  const modifiers = { ctrl: false, alt: false, meta: false, shift: false };
  for (const part of modifierParts) {
    switch (part.toUpperCase()) {
      case "C":
        modifiers.ctrl = true;
        break;
      case "A":
        modifiers.alt = true;
        break;
      case "M":
      case "D":
        modifiers.meta = true;
        break;
      case "S":
        modifiers.shift = true;
        break;
      default:
        return Result.fail(new KeySequenceError({ input, message: `unknown modifier "${part}" in <${inner}>` }));
    }
  }
  if (rawName === "") {
    return Result.fail(new KeySequenceError({ input, message: `missing key in <${inner}>` }));
  }
  const lower = rawName.toLowerCase();
  const named = NAMED_KEYS[lower];
  if (named !== undefined) return Result.succeed(stroke(named, modifiers));
  if (FUNCTION_KEY.test(lower)) return Result.succeed(stroke(lower.toUpperCase(), modifiers));
  if (isCharacterKey(rawName)) {
    // In a chord a letter names the key; shift in the chord picks its case.
    const key = modifiers.shift && rawName.length === 1 ? rawName.toUpperCase() : rawName;
    return Result.succeed(stroke(key, modifiers));
  }
  return Result.fail(new KeySequenceError({ input, message: `unknown key name <${inner}>` }));
}

/** Parse vim-style notation into strokes. The empty string is an empty sequence. */
export function parseSequence(input: string): Result.Result<ReadonlyArray<KeyStroke>, KeySequenceError> {
  const strokes: Array<KeyStroke> = [];
  const chars = [...input];
  let index = 0;
  while (index < chars.length) {
    const char = chars[index] ?? "";
    if (char === "<") {
      const close = chars.indexOf(">", index + 2);
      if (close === -1) {
        // A lone `<` is the character itself, as in vim.
        strokes.push(stroke("<"));
        index += 1;
        continue;
      }
      const parsed = parseBracket(input, chars.slice(index + 1, close).join(""));
      if (Result.isFailure(parsed)) return Result.fail(parsed.failure);
      strokes.push(parsed.success);
      index = close + 1;
      continue;
    }
    if (/\s/u.test(char)) {
      return Result.fail(new KeySequenceError({ input, message: "whitespace is not a key; write <Space>" }));
    }
    strokes.push(stroke(char));
    index += 1;
  }
  return Result.succeed(strokes);
}

/** The fields of a `KeyboardEvent` a stroke is read from (also what the bridge forwards). */
export interface KeyEventLike {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Fn", "OS", "Hyper", "Super"]);

/** Whether the event is a modifier being pressed on its own. */
export function isModifierOnly(event: KeyEventLike): boolean {
  return MODIFIER_KEYS.has(event.key);
}

const PRINTABLE_ASCII = /^[\x21-\x7e]$/u;

/**
 * The key a layout-independent physical code stands for, when the typed
 * character is not usable. Option on macOS turns `f` into `ƒ` (or a dead
 * key), so `<A-f>` must be read from `KeyF`.
 */
function keyFromCode(code: string, shift: boolean): string | undefined {
  const letter = /^Key([A-Z])$/u.exec(code)?.[1];
  if (letter !== undefined) return shift ? letter : letter.toLowerCase();
  const digit = /^Digit([0-9])$/u.exec(code)?.[1];
  if (digit !== undefined) return shift ? undefined : digit;
  // Punctuation by its US-layout position, the layout chord notation assumes.
  const punctuation = PUNCTUATION_CODES[code];
  return punctuation === undefined ? undefined : punctuation[shift ? 1 : 0];
}

const PUNCTUATION_CODES: Readonly<Record<string, readonly [string, string]>> = {
  Slash: ["/", "?"],
  Period: [".", ">"],
  Comma: [",", "<"],
  Semicolon: [";", ":"],
  Quote: ["'", '"'],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Backslash: ["\\", "|"],
  Minus: ["-", "_"],
  Equal: ["=", "+"],
  Backquote: ["`", "~"],
};

/** Read a stroke off a keyboard event. Undefined for a lone modifier. */
export function strokeFromEvent(event: KeyEventLike): KeyStroke | undefined {
  if (isModifierOnly(event)) return undefined;
  let key = event.key;
  if (event.altKey && !PRINTABLE_ASCII.test(key) && (isCharacterKey(key) || key === "Dead")) {
    key = keyFromCode(event.code, event.shiftKey) ?? key;
  } else if ((event.ctrlKey || event.metaKey) && isCharacterKey(key) && key.length === 1) {
    // With control or command held, browsers report the unshifted letter; shift picks the case.
    key = event.shiftKey ? key.toUpperCase() : key.toLowerCase();
  }
  return stroke(key, { ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey, shift: event.shiftKey });
}

/** Lowercase the character of a stroke: hint labels are typed case-insensitively. */
export function foldCase(value: KeyStroke): KeyStroke {
  return isCharacterKey(value.key) ? { ...value, key: value.key.toLowerCase() } : value;
}
