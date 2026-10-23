// The key engine: a keymap compiled into a trie of strokes, and a pure step
// function that feeds it one stroke at a time. Normal-mode bindings
// (`j`, `gg`, `<A-f>`) and hint labels (`sa`, `sd`, ...) are both keymaps;
// typing a hint is matching a sequence, and narrowing is the pending prefix.
import { foldCase, formatSequence, type KeyStroke, strokeId } from "./keys.ts";

export interface Binding<A> {
  readonly sequence: ReadonlyArray<KeyStroke>;
  readonly action: A;
}

interface TrieNode<A> {
  binding: Binding<A> | undefined;
  readonly children: Map<string, TrieNode<A>>;
}

export interface KeymapConflict<A> {
  /** The binding that was dropped. */
  readonly dropped: Binding<A>;
  /** The binding it collides with, which stays. */
  readonly kept: Binding<A>;
  readonly reason: "duplicate" | "prefix";
}

export interface KeymapOptions {
  /** Match characters case-insensitively (hint labels). */
  readonly foldCase?: boolean;
  /**
   * After a stroke that fits no binding below the pending prefix, try it again
   * as the start of a new sequence (vim's behaviour, the default). Off for hint
   * labels, where a wrong letter must not throw away what was typed.
   */
  readonly restartOnMiss?: boolean;
  /** A pending prefix older than this is forgotten. Infinity for hint labels. */
  readonly timeoutMs?: number;
}

export interface Keymap<A> {
  readonly root: TrieNode<A>;
  readonly bindings: ReadonlyArray<Binding<A>>;
  readonly conflicts: ReadonlyArray<KeymapConflict<A>>;
  readonly options: Required<KeymapOptions>;
}

export interface MatchState {
  readonly prefix: ReadonlyArray<KeyStroke>;
  /** When the last stroke of the prefix arrived, in milliseconds. */
  readonly at: number;
}

export type Step<A> =
  | { readonly kind: "match"; readonly binding: Binding<A> }
  | { readonly kind: "pending"; readonly prefix: ReadonlyArray<KeyStroke> }
  | { readonly kind: "miss" };

export const EMPTY_STATE: MatchState = { prefix: [], at: 0 };

const DEFAULT_OPTIONS: Required<KeymapOptions> = { foldCase: false, restartOnMiss: true, timeoutMs: 1000 };

function node<A>(): TrieNode<A> {
  return { binding: undefined, children: new Map() };
}

function firstBindingBelow<A>(start: TrieNode<A>): Binding<A> | undefined {
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (current.binding !== undefined) return current.binding;
    stack.push(...current.children.values());
  }
  return undefined;
}

/**
 * Compile bindings into a keymap. A binding that repeats or is a prefix of an
 * earlier one (or has one as its prefix) cannot ever be reached unambiguously;
 * it is dropped and reported as a conflict, and the earlier binding stays.
 * Empty sequences mean "unbound" and are skipped.
 */
export function compileKeymap<A>(bindings: Iterable<Binding<A>>, options: KeymapOptions = {}): Keymap<A> {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const root = node<A>();
  const kept: Array<Binding<A>> = [];
  const conflicts: Array<KeymapConflict<A>> = [];
  for (const binding of bindings) {
    if (binding.sequence.length === 0) continue;
    let current = root;
    let blocked: KeymapConflict<A> | undefined;
    const path: Array<[TrieNode<A>, string]> = [];
    for (const raw of binding.sequence) {
      if (current.binding !== undefined) {
        blocked = { dropped: binding, kept: current.binding, reason: "prefix" };
        break;
      }
      const id = strokeId(resolved.foldCase ? foldCase(raw) : raw);
      let next = current.children.get(id);
      if (next === undefined) {
        next = node<A>();
        path.push([current, id]);
        current.children.set(id, next);
      }
      current = next;
    }
    if (blocked === undefined && current.binding !== undefined) {
      blocked = { dropped: binding, kept: current.binding, reason: "duplicate" };
    }
    if (blocked === undefined && current.children.size > 0) {
      const longer = firstBindingBelow(current);
      if (longer !== undefined) blocked = { dropped: binding, kept: longer, reason: "prefix" };
    }
    if (blocked !== undefined) {
      // Undo the nodes this binding created, so a dropped binding leaves no trace.
      for (const [parent, id] of path.toReversed()) {
        const child = parent.children.get(id);
        if (child !== undefined && child.children.size === 0 && child.binding === undefined) {
          parent.children.delete(id);
        }
      }
      conflicts.push(blocked);
      continue;
    }
    current.binding = binding;
    kept.push(binding);
  }
  return { root, bindings: kept, conflicts, options: resolved };
}

function walk<A>(keymap: Keymap<A>, strokes: ReadonlyArray<KeyStroke>): TrieNode<A> | undefined {
  let current: TrieNode<A> | undefined = keymap.root;
  for (const raw of strokes) {
    const id = strokeId(keymap.options.foldCase ? foldCase(raw) : raw);
    current = current.children.get(id);
    if (current === undefined) return undefined;
  }
  return current;
}

function stepFrom<A>(keymap: Keymap<A>, prefix: ReadonlyArray<KeyStroke>, stroke: KeyStroke, now: number): [MatchState, Step<A>] {
  const extended = [...prefix, stroke];
  const target = walk(keymap, extended);
  if (target === undefined) return [{ prefix, at: now }, { kind: "miss" }];
  if (target.binding !== undefined) return [EMPTY_STATE, { kind: "match", binding: target.binding }];
  return [{ prefix: extended, at: now }, { kind: "pending", prefix: extended }];
}

/** The state with a pending prefix older than the keymap's timeout forgotten. */
export function expire(keymap: Keymap<unknown>, state: MatchState, now: number): MatchState {
  return state.prefix.length > 0 && now - state.at > keymap.options.timeoutMs ? EMPTY_STATE : state;
}

/** Feed one stroke. Pure: returns the next state and what the stroke did. */
export function feed<A>(keymap: Keymap<A>, state: MatchState, stroke: KeyStroke, now: number): [MatchState, Step<A>] {
  const { prefix } = expire(keymap, state, now);
  const [next, step] = stepFrom(keymap, prefix, stroke, now);
  if (step.kind !== "miss" || prefix.length === 0) return [next, step];
  if (!keymap.options.restartOnMiss) return [{ prefix, at: state.at }, step];
  const [restarted, retried] = stepFrom(keymap, [], stroke, now);
  return retried.kind === "miss" ? [EMPTY_STATE, retried] : [restarted, retried];
}

/** Whether the pending prefix leads somewhere in this keymap. */
export function within(keymap: Keymap<unknown>, state: MatchState): boolean {
  return walk(keymap, state.prefix) !== undefined;
}

/** Undo the last stroke of the pending prefix (Backspace while typing a hint). */
export function back(state: MatchState): MatchState {
  return state.prefix.length === 0 ? state : { prefix: state.prefix.slice(0, -1), at: state.at };
}

/** The prefix as typed text, for highlighting what matched so far. */
export function typed(keymap: Keymap<unknown>, state: MatchState): string {
  const strokes = keymap.options.foldCase ? state.prefix.map(foldCase) : state.prefix;
  return formatSequence(strokes);
}
