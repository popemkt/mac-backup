import { memo, useCallback } from "react";
import { isQueryNode } from "@/lib/query-node";
import { childInstanceKey, outlineInstanceKey } from "@/lib/instance-key";
import { resolveProps } from "@/lib/graph-view";
import { useUiStore } from "@/stores/ui.store";
import { usePrefsStore } from "@/stores/prefs.store";
import { useOutlineStore } from "@/stores/outline.store";
import { mutations } from "@/actions/mutations";
import { getViewConfig } from "@/lib/view-config";
import { Bullet } from "./bullet";
import { FieldsSection } from "./fields-section";
import { GhostNodeRow } from "./ghost-node-row";
import { NodeContent } from "./node-content";
import { NodeRow } from "./node-row";
import { QueryResultsSection } from "./query-results";
import { TableView } from "./table-view";
import { useNodeKeyDown } from "./use-node-keydown";
import { ViewToolbar } from "./view-toolbar";

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

  const handleKeyDown = useNodeKeyDown({
    nodeId,
    instanceKey,
    node,
    isRef,
  });

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
  const viewConfig = getViewConfig(node.props);

  return (
    <div
      className="node-block relative group/frame"
      data-node-id={nodeId}
      data-instance-key={instanceKey}
    >
      <div className="relative flex items-center">
        <div className="flex-1 min-w-0">
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
        </div>
        {hasChildren && !node.collapsed && (
          <div className="absolute right-2 opacity-0 group-hover/frame:opacity-100 group-focus-within/frame:opacity-100 transition-opacity z-10">
            <ViewToolbar frameId={nodeId} mode={viewConfig.mode} />
          </div>
        )}
      </div>

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
            (viewConfig.mode === "table" ? (
              <div style={{ paddingLeft: `${(depth + 1) * 24}px` }}>
                <TableView
                  frameId={nodeId}
                  frameInstanceKey={instanceKey}
                />
              </div>
            ) : (
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
              })
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
