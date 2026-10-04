import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import {
  getCaretSerializedOffset,
  renderInlineMarkdown,
  revealMarkupAtSelection,
  serializeEditable,
  setCaretSerializedOffset,
  type RefInk,
} from "../lib/md-edit";
import {
  emptyTextHistory,
  recordTextEdit,
  redoTextEdit,
  undoTextEdit,
  type TextState,
} from "../lib/text-history";

/**
 * Text undo for the row being edited (`lib/text-history`).
 *
 * It records the row's text as it arrives — every write reaches the host as
 * `content`, whether it was typed, completed from `[[` or broken with
 * Shift+Enter — so no edit path has to remember to record itself. The
 * returned `step` answers an undo or redo chord; `beforeinput`'s
 * `historyUndo` / `historyRedo` (the Edit menu) route to it too.
 */
export function useTextHistory({
  editorRef,
  editing,
  content,
  ink,
  onRestore,
}: {
  editorRef: RefObject<HTMLDivElement | null>;
  editing: boolean;
  content: string;
  /** How the restored text's references are inked (`RefInk`). */
  ink: RefInk;
  /** The text a step restored, for the surface to write. */
  onRestore: (state: TextState) => void;
}): (direction: "undo" | "redo") => void {
  const history = useRef(emptyTextHistory);
  const last = useRef<TextState | null>(null);

  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!editing || !el) {
      history.current = emptyTextHistory;
      last.current = null;
      return;
    }
    const state = { text: content, caret: getCaretSerializedOffset(el) };
    const prev = last.current;
    last.current = state;
    if (prev !== null && prev.text !== content) {
      history.current = recordTextEdit(history.current, prev, Date.now());
    }
  }, [editorRef, editing, content]);

  const step = useCallback(
    (direction: "undo" | "redo") => {
      const el = editorRef.current;
      if (!el) return;
      const current = { text: serializeEditable(el), caret: getCaretSerializedOffset(el) };
      const result =
        direction === "undo"
          ? undoTextEdit(history.current, current)
          : redoTextEdit(history.current, current);
      if (!result) return;
      history.current = result.history;
      // The restored text arrives back as `content`; it is not a new edit.
      last.current = result.state;
      renderInlineMarkdown(el, result.state.text, ink);
      setCaretSerializedOffset(el, result.state.caret);
      revealMarkupAtSelection(el);
      onRestore(result.state);
    },
    [editorRef, onRestore, ink],
  );

  useEffect(() => {
    const el = editorRef.current;
    if (!editing || !el) return undefined;
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType !== "historyUndo" && e.inputType !== "historyRedo") return;
      e.preventDefault();
      step(e.inputType === "historyUndo" ? "undo" : "redo");
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, [editorRef, editing, step]);

  return step;
}
