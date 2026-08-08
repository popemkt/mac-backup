import { useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { mutations } from "@/actions/mutations";
import { cn } from "@/lib/cn";
import { useOutlineStore } from "@/stores/outline.store";
import { NodeRow } from "./node-row";

interface GhostNodeRowProps {
  depth: number;
  /** Parent outline node, or workspace root for home-level ghost. */
  parentId: string;
  /** Last sibling id to insert after; omit to append first child under parent. */
  afterSiblingId?: string | null;
}

function GhostBullet() {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center">
      <span className="h-1 w-1 rounded-full bg-foreground/25" />
    </span>
  );
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

  const beginEditing = useCallback((newId: string, cursorPos: number) => {
    flushSync(() => {
      useOutlineStore.getState().activateNode(newId, cursorPos);
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

  return (
    <NodeRow
      depth={depth}
      bullet={<GhostBullet />}
      content={
        <div
          tabIndex={0}
          role="textbox"
          aria-label="New node"
          data-ghost-row="true"
          className={cn(
            "ghost-row min-h-6 min-w-0 flex-1 cursor-text rounded-sm px-1 outline-none",
          )}
          onKeyDown={handleKeyDown}
        />
      }
    />
  );
}
