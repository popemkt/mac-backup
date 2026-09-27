import { useEffect, type RefObject } from "react";
import { revealMarkupAtSelection } from "@/lib/md-edit";

/**
 * While `editing`, the markup under the caret shows, wherever the caret moved
 * it from: a click, an arrow, a caret the host placed. Shared by every
 * live-preview surface (node text, a text field's value).
 */
export function useRevealMarkup(editorRef: RefObject<HTMLElement | null>, editing: boolean): void {
  useEffect(() => {
    const el = editorRef.current;
    if (!editing || !el) return undefined;
    const reveal = () => revealMarkupAtSelection(el);
    document.addEventListener("selectionchange", reveal);
    return () => document.removeEventListener("selectionchange", reveal);
  }, [editorRef, editing]);
}
