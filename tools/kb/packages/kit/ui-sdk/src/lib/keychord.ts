/**
 * Chord matching, once, for both outline keymaps.
 *
 * A keymap is a list of `{ chord, … }` rows resolved first-match, exactly the
 * order an `if`/`switch` chain resolves in — which is what makes replacing a
 * chain with a table behaviour-preserving. The chord itself is a set of
 * optional constraints: a constraint that is absent is not asked about, so
 * `{ key: "Enter" }` claims Enter with or without Shift, and `{ alt: false }`
 * claims only the unmodified form.
 *
 * Both keymaps read this module rather than each testing `event.metaKey`
 * themselves: "does this event match this chord" is one question, so it has one
 * answer.
 */

/** The parts of a keyboard event a chord is allowed to look at. */
export interface KeyChordEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** One key, several spellings of one key, or a predicate over the name. */
type KeyMatch = string | readonly string[] | ((key: string) => boolean);

export interface Chord {
  /** Absent ⇒ any key; the modifier constraints then carry the whole chord. */
  key?: KeyMatch;
  /**
   * `metaKey || ctrlKey` — the platform-agnostic "command" modifier.
   *
   * {@link Chord.meta} exists beside it because the editing keymap
   * distinguishes them: ⌘⇧↑ reorders a row while ⌃⇧↑ collapses it. Ask with
   * `mod` unless a binding genuinely means the Command key.
   */
  mod?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** A single-character key name — the printable fall-through both maps use. */
export function isPrintableKey(key: string): boolean {
  return key.length === 1;
}

function keyMatches(match: KeyMatch | undefined, key: string): boolean {
  if (match === undefined) return true;
  if (typeof match === "string") return match === key;
  if (typeof match === "function") return match(key);
  return match.includes(key);
}

function flagMatches(required: boolean | undefined, actual: boolean): boolean {
  return required === undefined || required === actual;
}

/** True when `ev` satisfies every constraint the chord states. */
function matchesChord(ev: KeyChordEvent, chord: Chord): boolean {
  return (
    keyMatches(chord.key, ev.key) &&
    flagMatches(chord.mod, ev.metaKey === true || ev.ctrlKey === true) &&
    flagMatches(chord.meta, ev.metaKey === true) &&
    flagMatches(chord.shift, ev.shiftKey === true) &&
    flagMatches(chord.alt, ev.altKey === true)
  );
}

/** Anything a keymap table holds: a chord, plus whatever the map does with it. */
interface ChordBinding {
  readonly chord: Chord;
}

/**
 * The first binding whose chord matches, or undefined.
 *
 * `accepts` is the second half of a row's condition for maps whose rows depend
 * on more than the event — the editing map's reference guard asks about the
 * caret. A row the predicate rejects is skipped, so the search continues down
 * the table exactly as a failed `if` continues down a chain.
 */
export function lookupChord<B extends ChordBinding>(
  ev: KeyChordEvent,
  bindings: readonly B[],
  accepts: (binding: B) => boolean = () => true,
): B | undefined {
  return bindings.find((binding) => matchesChord(ev, binding.chord) && accepts(binding));
}
