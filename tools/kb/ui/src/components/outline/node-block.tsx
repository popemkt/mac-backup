import { memo, useCallback } from "react";
import { isQueryNode } from "@/lib/query-node";
import { childInstanceKey, outlineInstanceKey } from "@/lib/instance-key";
import { resolveProps } from "@/lib/graph-view";
import { useUiStore } from "@/stores/ui.store";
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
  /** Stable render-instance id (parent-path or ref-container + nodeId). */
  instanceKey?: string;
  /** Reference-row state for query results / embeds (dashed bullet ring). */
  isRef?: boolean;
}

export const NodeBlock = memo(function NodeBlock({
  nodeId,
  depth,
  instanceKey: instanceKeyProp,
  isRef = false,
}: NodeBlockProps) {
  const node = useOutlineStore((s) => s.nodes.get(nodeId));
  const nodes = useOutlineStore((s) => s.nodes);
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);
  const activeInstanceKey = useOutlineStore((s) => s.activeInstanceKey);
  const selectedNodeId = useOutlineStore((s) => s.selectedNodeId);
  const selectedInstanceKey = useOutlineStore((s) => s.selectedInstanceKey);
  const cursorPosition = useOutlineStore((s) => s.cursorPosition);
  const activateNode = useOutlineStore((s) => s.activateNode);
  const selectNode = useOutlineStore((s) => s.selectNode);
  const toggleCollapse = useOutlineStore((s) => s.toggleCollapse);
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const getPreviousVisibleInstance = useOutlineStore(
    (s) => s.getPreviousVisibleInstance,
  );
  const getNextVisibleInstance = useOutlineStore(
    (s) => s.getNextVisibleInstance,
  );
  const showAllFields = usePrefsStore((s) => s.showAllFields);
  const nodePaletteOpen = useUiStore((s) => s.nodePaletteOpen);

  const instanceKey =
    instanceKeyProp ?? outlineInstanceKey(nodeId, nodes);

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
      activateNode(nodeId, cursorPos, instanceKey);
    },
    [activateNode, nodeId, instanceKey],
  );

  const handleRowSelect = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        selectNode(nodeId, instanceKey);
      }
    },
    [selectNode, nodeId, instanceKey],
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
            const prev = getPreviousVisibleInstance(instanceKey);
            void mutations.deleteNode(nodeId).then(() => {
              if (prev) {
                const prevNode = useOutlineStore
                  .getState()
                  .nodes.get(prev.nodeId);
                activateNode(
                  prev.nodeId,
                  prevNode?.text.length ?? 0,
                  prev.instanceKey,
                );
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
          const prev = getPreviousVisibleInstance(instanceKey);
          if (prev) {
            const prevNode = useOutlineStore.getState().nodes.get(prev.nodeId);
            activateNode(
              prev.nodeId,
              prevNode?.text.length ?? 0,
              prev.instanceKey,
            );
          }
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        useOutlineStore.getState().selectNode(nodeId, instanceKey);
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
          const next = getNextVisibleInstance(instanceKey);
          if (next) activateNode(next.nodeId, 0, next.instanceKey);
        }
        return;
      }
    },
    [
      nodeId,
      node,
      isRef,
      instanceKey,
      toggleCollapse,
      activateNode,
      getPreviousVisibleInstance,
      getNextVisibleInstance,
    ],
  );

  if (!node) return null;

  const isActive =
    activeNodeId === nodeId && activeInstanceKey === instanceKey;
  const isSelected =
    selectedNodeId === nodeId && selectedInstanceKey === instanceKey;
  const isPaletteAnchor =
    nodePaletteOpen &&
    ((selectedNodeId === nodeId && selectedInstanceKey === instanceKey) ||
      (activeNodeId === nodeId && activeInstanceKey === instanceKey));
  const hasChildren = node.children.length > 0;
  const isQuery = isQueryNode(node);
  const hasFields =
    resolveProps(node, nodes, { showAllFields }).length > 0;
  const isExpandable = hasChildren || isQuery || hasFields;

  return (
    <div
      className="node-block relative"
      data-node-id={nodeId}
      data-instance-key={instanceKey}
    >
      <NodeRow
        depth={depth}
        nodeId={nodeId}
        instanceKey={instanceKey}
        isSelected={isSelected || isPaletteAnchor}
        isActive={isActive}
        onRowClick={handleRowSelect}
        bullet={
          <Bullet
            node={node}
            collapsible={isExpandable}
            isRef={isRef}
            tagColor={primaryTagColor}
            onClick={handleBulletClick}
          />
        }
        content={
          <NodeContent
            nodeId={nodeId}
            instanceKey={instanceKey}
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
            node.children.map((childId) => {
              const childKey = childInstanceKey(instanceKey, childId);
              return (
                <NodeBlock
                  key={childKey}
                  nodeId={childId}
                  instanceKey={childKey}
                  depth={depth + 1}
                />
              );
            })}

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
