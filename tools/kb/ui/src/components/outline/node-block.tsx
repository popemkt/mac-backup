import { memo, useCallback } from "react";
import { isQueryNode } from "@/lib/query-node";
import { resolveProps } from "@/lib/graph-view";
import { usePrefsStore } from "@/stores/prefs.store";
import { useOutlineStore } from "@/stores/outline.store";
import { mutations } from "@/actions/mutations";
import { Bullet } from "./bullet";
import { FieldsSection } from "./fields-section";
import { GhostNodeRow } from "./ghost-node-row";
import { NodeContent } from "./node-content";
import { NodeRow } from "./node-row";
import { QueryResultsSection } from "./query-results";

interface NodeBlockProps {
  nodeId: string;
  depth: number;
  /** Reference-row state for query results / embeds (dashed bullet ring). */
  isRef?: boolean;
}

export const NodeBlock = memo(function NodeBlock({
  nodeId,
  depth,
  isRef = false,
}: NodeBlockProps) {
  const node = useOutlineStore((s) => s.nodes.get(nodeId));
  const nodes = useOutlineStore((s) => s.nodes);
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);
  const selectedNodeId = useOutlineStore((s) => s.selectedNodeId);
  const cursorPosition = useOutlineStore((s) => s.cursorPosition);
  const activateNode = useOutlineStore((s) => s.activateNode);
  const selectNode = useOutlineStore((s) => s.selectNode);
  const toggleCollapse = useOutlineStore((s) => s.toggleCollapse);
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const getPreviousVisibleNode = useOutlineStore(
    (s) => s.getPreviousVisibleNode,
  );
  const getNextVisibleNode = useOutlineStore((s) => s.getNextVisibleNode);
  const showAllFields = usePrefsStore((s) => s.showAllFields);

  const primaryTagColor = node?.tags[0]?.color ?? null;

  const handleBulletClick = useCallback(
    (e: React.MouseEvent) => {
      if (isRef || e.metaKey || e.ctrlKey) {
        zoomTo(nodeId);
      } else {
        toggleCollapse(nodeId);
      }
    },
    [toggleCollapse, zoomTo, nodeId, isRef],
  );

  const handleActivate = useCallback(
    (cursorPos?: number) => {
      activateNode(nodeId, cursorPos);
    },
    [activateNode, nodeId],
  );

  const handleRowSelect = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        selectNode(nodeId);
      }
    },
    [selectNode, nodeId],
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

      if (isRef) {
        const structural =
          e.key === "Tab" ||
          (e.key === "Enter" && !e.shiftKey) ||
          ((e.key === "Backspace" || e.key === "Delete") &&
            (e.metaKey || e.ctrlKey)) ||
          (e.key === "Backspace" && cursor === 0) ||
          ((e.key === "ArrowUp" || e.key === "ArrowDown") &&
            e.metaKey &&
            e.shiftKey);
        if (structural) {
          e.preventDefault();
          return;
        }
      }

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
      isRef,
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
  const isQuery = isQueryNode(node);
  const hasFields =
    resolveProps(node, nodes, { showAllFields }).length > 0;
  const isExpandable = hasChildren || isQuery || hasFields;

  return (
    <div className="node-block relative" data-node-id={nodeId}>
      <NodeRow
        depth={depth}
        nodeId={nodeId}
        isSelected={isSelected}
        isActive={isActive}
        onRowClick={handleRowSelect}
        bullet={
          <Bullet
            node={node}
            isRef={isRef}
            tagColor={primaryTagColor}
            onClick={handleBulletClick}
          />
        }
        content={
          <NodeContent
            nodeId={nodeId}
            content={node.text}
            isActive={isActive}
            tags={node.tags}
            cursorPosition={cursorPosition}
            onActivate={handleActivate}
            onChange={handleContentChange}
            onKeyDown={handleKeyDown}
          />
        }
      />

      {isExpandable && !node.collapsed && (
        <div className="children-container relative">
          <div
            className="absolute top-0 bottom-2 w-5 cursor-pointer group/line"
            style={{ left: `${depth * 24 + 2}px` }}
            onClick={handleBulletClick}
          >
            <div className="absolute left-[9px] top-0 bottom-0 w-px bg-foreground/[0.06] group-hover/line:bg-foreground/15 transition-colors duration-200" />
          </div>

          <FieldsSection nodeId={nodeId} depth={depth} />

          {!isRef && isQuery && (
            <QueryResultsSection nodeId={nodeId} depth={depth} />
          )}

          {hasChildren &&
            node.children.map((childId) => (
              <NodeBlock
                key={childId}
                nodeId={childId}
                depth={depth + 1}
                isRef={isRef}
              />
            ))}

          {!isRef && (
            <GhostNodeRow
              depth={depth + 1}
              parentId={nodeId}
              afterSiblingId={
                node.children.length > 0
                  ? node.children[node.children.length - 1]!
                  : null
              }
            />
          )}
        </div>
      )}
    </div>
  );
});
