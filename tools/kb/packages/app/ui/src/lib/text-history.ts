/**
 * Undo history for one row's text while it is being edited.
 *
 * The editor rebuilds its DOM whenever typing re-forms the formatting (the
 * second `*` of `**`), and a browser's native undo stack does not survive a
 * script rewriting the nodes it recorded. So the editor answers
 * `historyUndo` / `historyRedo` itself from this record of the text and the
 * caret, which a rebuild cannot invalidate. Structural undo (split, merge,
 * indent …) is the outline store's and is not this; this is the text of the
 * row under the caret, for as long as the caret stays in it.
 */

export interface TextState {
  readonly text: string;
  readonly caret: number;
}

export interface TextHistory {
  readonly undo: readonly TextState[];
  readonly redo: readonly TextState[];
  /** When the last entry was recorded, for coalescing a typing burst. */
  readonly at: number;
}

/** Keystrokes closer together than this undo as one step. */
export const TEXT_HISTORY_COALESCE_MS = 800;
const LIMIT = 200;

export const emptyTextHistory: TextHistory = { undo: [], redo: [], at: Number.NEGATIVE_INFINITY };

/**
 * Record that the text is about to leave `before`. A burst of typing records
 * only its first state, so one undo takes the burst back.
 */
export function recordTextEdit(history: TextHistory, before: TextState, now: number): TextHistory {
  if (now - history.at < TEXT_HISTORY_COALESCE_MS && history.undo.length > 0) {
    return { undo: history.undo, redo: [], at: now };
  }
  return { undo: [...history.undo, before].slice(-LIMIT), redo: [], at: now };
}

/** Step back from `current`; null when there is nothing to undo. */
export function undoTextEdit(
  history: TextHistory,
  current: TextState,
): { history: TextHistory; state: TextState } | null {
  const state = history.undo.at(-1);
  if (state === undefined) return null;
  return {
    history: {
      undo: history.undo.slice(0, -1),
      redo: [...history.redo, current],
      at: Number.NEGATIVE_INFINITY,
    },
    state,
  };
}

/** Step forward from `current`; null when there is nothing to redo. */
export function redoTextEdit(
  history: TextHistory,
  current: TextState,
): { history: TextHistory; state: TextState } | null {
  const state = history.redo.at(-1);
  if (state === undefined) return null;
  return {
    history: {
      undo: [...history.undo, current],
      redo: history.redo.slice(0, -1),
      at: Number.NEGATIVE_INFINITY,
    },
    state,
  };
}
