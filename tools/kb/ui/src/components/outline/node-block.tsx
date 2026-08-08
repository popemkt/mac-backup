import { memo, useCallback } from "react";
import { cn } from "@/lib/cn";
import { useOutlineStore } from "@/stores/outline.store";
import { mutations } from "@/actions/mutations";
import { Bullet } from "./bullet";
import { NodeContent } from "./node-content";

interface NodeBlockProps {
  nodeId: string;
  depth: number;
}

export const NodeBlock = memo(function NodeBlock({
  nodeId,
  depth,
}: NodeBlockProps) {
  const node = useOutlineStore((s) => s.nodes.get(nodeId));
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);
  const selectedNodeId = useOutlineStore((s) => s.selectedNodeId);
  const cursorPosition = useOutlineStore((s) => s.cursorPosition);
  const activateNode = useOutlineStore((s) => s.activateNode);
  const toggleCollapse = useOutlineStore((s) => s.toggleCollapse);
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const getPreviousVisibleNode = useOutlineStore(
    (s) => s.getPreviousVisibleNode,
  );
  const getNextVisibleNode = useOutlineStore((s) => s.getNextVisibleNode);

  const handleBulletClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey) {
        zoomTo(nodeId);
      } else {
        toggleCollapse(nodeId);
      }
    },
    [toggleCollapse, zoomTo, nodeId],
  );

  const handleActivate = useCallback(
    (cursorPos?: number) => {
      activateNode(nodeId, cursorPos);
    },
    [activateNode, nodeId],
  );

  const handleContentChange = useCallback(
    (content: string) => {
      mutations.updateNodeContent(nodeId, content);
    },
    [nodeId],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const sel = window.getSelection();
      const cursor = sel?.focusOffset ?? 0;

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void mutations.splitNode(nodeId, cursor);
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) void mutations.outdentNode(nodeId);
        else void mutations.indentNode(nodeId);
        return;
      }

      if (e.key === "Backspace" && !e.metaKey && !e.ctrlKey) {
        if (cursor === 0) {
          e.preventDefault();
          if (node?.text === "" && (node?.children.length ?? 0) === 0) {
            const prev = getPreviousVisibleNode(nodeId);
            void mutations.deleteNode(nodeId).then(() => {
              if (prev) {
                const prevNode = useOutlineStore.getState().nodes.get(prev);
                activateNode(prev, prevNode?.text.length ?? 0);
              }
            });
          } else {
            void mutations.mergeWithPrevious(nodeId);
          }
          return;
        }
      }

      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        (e.metaKey || e.ctrlKey)
      ) {
        e.preventDefault();
        void mutations.deleteNode(nodeId);
        return;
      }

      if (e.key === "ArrowUp") {
        if (e.metaKey && e.shiftKey) {
          e.preventDefault();
          void mutations.moveNodeUp(nodeId);
          return;
        }
        if (e.metaKey) {
          e.preventDefault();
          if (node?.children.length && !node.collapsed) {
            toggleCollapse(nodeId);
          }
          return;
        }
        if (cursor === 0) {
          e.preventDefault();
          const prevId = getPreviousVisibleNode(nodeId);
          if (prevId) {
            const prevNode = useOutlineStore.getState().nodes.get(prevId);
            activateNode(prevId, prevNode?.text.length ?? 0);
          }
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        useOutlineStore.getState().selectNode(nodeId);
        return;
      }

      if (e.key === "ArrowDown") {
        if (e.metaKey && e.shiftKey) {
          e.preventDefault();
          void mutations.moveNodeDown(nodeId);
          return;
        }
        if (e.metaKey) {
          e.preventDefault();
          if (node?.children.length && node.collapsed) {
            toggleCollapse(nodeId);
          }
          return;
        }
        const isAtEnd = cursor === (node?.text.length ?? 0);
        if (isAtEnd) {
          e.preventDefault();
          const nextId = getNextVisibleNode(nodeId);
          if (nextId) activateNode(nextId, 0);
        }
        return;
      }
    },
    [
      nodeId,
      node,
      toggleCollapse,
      activateNode,
      getPreviousVisibleNode,
      getNextVisibleNode,
    ],
  );

  if (!node) return null;

  const isActive = activeNodeId === nodeId;
  const isSelected = selectedNodeId === nodeId;
  const hasChildren = node.children.length > 0;

  return (
    <div className="node-block relative" data-node-id={nodeId}>
      <div
        className={cn(
          "node-row group/node flex items-start",
          "rounded-sm transition-colors duration-75",
          isSelected && !isActive && "bg-teal-900/5",
        )}
        style={{ paddingLeft: `${depth * 24}px` }}
      >
        <Bullet
          hasChildren={hasChildren}
          collapsed={node.collapsed}
          childCount={node.children.length}
          onClick={handleBulletClick}
        />
        <NodeContent
          nodeId={nodeId}
          content={node.text}
          isActive={isActive}
          isSelected={isSelected}
          tags={node.tags}
          cursorPosition={cursorPosition}
          onActivate={handleActivate}
          onChange={handleContentChange}
          onKeyDown={handleKeyDown}
        />
      </div>

      {hasChildren && !node.collapsed && (
        <div className="children-container relative">
          <div
            className="absolute top-0 bottom-2 w-5 cursor-pointer group/line"
            style={{ left: `${depth * 24 + 2}px` }}
            onClick={handleBulletClick}
          >
            <div className="absolute left-[9px] top-0 bottom-0 w-px bg-stone-900/10 group-hover/line:bg-stone-900/25 transition-colors duration-200" />
          </div>
          {node.children.map((childId) => (
            <NodeBlock key={childId} nodeId={childId} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
});
