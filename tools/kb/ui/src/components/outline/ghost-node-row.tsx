import { useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { mutations } from "@/actions/mutations";
import { cn } from "@/lib/cn";
import { outlineInstanceKey } from "@/lib/instance-key";
import { useOutlineStore } from "@/stores/outline.store";
import { NodeRow } from "./node-row";

interface GhostNodeRowProps {
  depth: number;
  /** Parent outline node, or workspace root for home-level ghost. */
  parentId: string;
  /** Last sibling id to insert after; omit to append first child under parent. */
  afterSiblingId?: string | null;
}

function isPrintableGhostKey(e: React.KeyboardEvent | KeyboardEvent): boolean {
  return (
    e.key.length === 1 &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    e.key !== " "
  );
}

export function GhostNodeRow({
  depth,
  parentId,
  afterSiblingId = null,
}: GhostNodeRowProps) {
  const creatingRef = useRef(false);
  const pendingCharsRef = useRef("");
  const rowRef = useRef<HTMLDivElement>(null);

  const focusGhost = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    el.focus();
    // Place caret so the empty ghost shows a typing cursor immediately.
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }, []);

  const beginEditing = useCallback((newId: string, cursorPos: number) => {
    flushSync(() => {
      const store = useOutlineStore.getState();
      const key = outlineInstanceKey(newId, store.nodes);
      store.activateNode(newId, cursorPos, key);
    });
  }, []);

  const createNode = useCallback(
    async (text: string) => {
      if (creatingRef.current) {
        if (text.length === 1) pendingCharsRef.current += text;
        return;
      }
      creatingRef.current = true;
      pendingCharsRef.current = "";
      try {
        const newId = await mutations.createGhostNode(
          parentId,
          afterSiblingId,
          text,
        );
        if (newId) {
          const pending = pendingCharsRef.current;
          pendingCharsRef.current = "";
          const fullText = text + pending;
          if (pending.length > 0) {
            mutations.updateNodeContent(newId, fullText);
          }
          beginEditing(newId, fullText.length);
        }
      } finally {
        creatingRef.current = false;
      }
    },
    [afterSiblingId, beginEditing, parentId],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (creatingRef.current) {
        e.preventDefault();
        if (isPrintableGhostKey(e)) {
          pendingCharsRef.current += e.key;
        }
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void createNode("");
        return;
      }
      if (isPrintableGhostKey(e)) {
        e.preventDefault();
        void createNode(e.key);
      }
    },
    [createNode],
  );

  const handleBulletMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Keep focus on the ghost textbox — do not let the bullet steal it.
      e.preventDefault();
      e.stopPropagation();
      focusGhost();
    },
    [focusGhost],
  );

  const handleContentMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleContentClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      focusGhost();
    },
    [focusGhost],
  );

  return (
    <NodeRow
      depth={depth}
      bullet={
        <span
          data-ghost-bullet="true"
          className="flex h-6 w-6 shrink-0 cursor-text items-center justify-center"
          onMouseDown={handleBulletMouseDown}
          onClick={handleBulletMouseDown}
        >
          <span className="h-1 w-1 rounded-full bg-foreground/25" />
        </span>
      }
      content={
        <div
          ref={rowRef}
          tabIndex={0}
          role="textbox"
          contentEditable
          suppressContentEditableWarning
          aria-label="New node"
          data-ghost-row="true"
          className={cn(
            "ghost-row min-h-6 min-w-0 flex-1 cursor-text rounded-sm px-1 outline-none",
            "text-[14.5px] leading-[1.6] text-foreground/85 caret-foreground/70",
            "empty:before:pointer-events-none empty:before:text-foreground/25",
          )}
          onMouseDown={handleContentMouseDown}
          onClick={handleContentClick}
          onKeyDown={handleKeyDown}
        />
      }
    />
  );
}
