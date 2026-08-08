import { useCallback, useRef } from "react";
import { mutations } from "@/actions/mutations";
import { cn } from "@/lib/cn";
import { KB_TEXT_CLASS } from "@/lib/md-inline";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
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

export function GhostNodeRow({
  depth,
  parentId,
  afterSiblingId = null,
}: GhostNodeRowProps) {
  const focusRef = useRef<HTMLDivElement>(null);

  const createNode = useCallback(
    async (text: string) => {
      await mutations.createGhostNode(parentId, afterSiblingId, text);
      requestAnimationFrame(() => focusRef.current?.focus());
    },
    [afterSiblingId, parentId],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void createNode("");
        return;
      }
      if (
        e.key.length === 1 &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key !== " "
      ) {
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
          ref={focusRef}
          tabIndex={0}
          role="textbox"
          aria-label="New node"
          data-ghost-row="true"
          className={cn(
            "ghost-row flex min-h-6 min-w-0 flex-1 cursor-text items-start rounded-sm px-1 outline-none",
            KB_TEXT_CLASS,
            "italic text-foreground/25 focus:text-foreground/35",
          )}
          onKeyDown={handleKeyDown}
        >
          New node…
        </div>
      }
    />
  );
}

export { WORKSPACE_ROOT_ID };
