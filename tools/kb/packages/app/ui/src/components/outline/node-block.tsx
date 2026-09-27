import { memo, useCallback, useMemo } from "react";
import { shownNodeId } from "@/lib/contextual-ref";
import { cn } from "@/lib/cn";
import { guideLineStyle, indentStyle } from "@/lib/indent";
import { childInstanceKey, isQueryResultInstance, outlineInstanceKey } from "@/lib/instance-key";
import { resolveRowChrome } from "@/lib/row-chrome";
import { useUiStore } from "@/stores/ui.store";
import { useDebugFields } from "@/stores/debug-fields.store";
import { schemaOf } from "@/lib/schema";
import { useOutlineStore } from "@/stores/outline.store";
import { useFollow } from "@/stores/follow";
import { bulletClickIntent, nodeTarget } from "@/lib/follow";
import { mutations } from "@/actions/mutations";
import { frameListChildren } from "@/lib/frame-rows";
import { getViewConfig, isProjectedViewMode } from "@/lib/view-config";
import { Bullet } from "./bullet";
import { FieldsSection } from "./fields-section";
import { FrameChildrenView } from "./frame-children-view";
import { NodeContent } from "./node-content";
import { NodeRow } from "./node-row";
import { QueryResultsSection } from "./query-results";
import { useNodeKeyDown } from "./use-node-keydown";
import { ViewToolbar } from "./view-toolbar";

interface NodeBlockProps {
  nodeId: string;
  depth: number;
  /**
   * Stable render-instance id (parent-path or ref-container + nodeId). Whether
   * the row is a query result is read from it (`isQueryResultInstance`).
   */
  instanceKey?: string;
}

export const NodeBlock = memo(function NodeBlock({
  nodeId,
  depth,
  instanceKey: instanceKeyProp,
}: NodeBlockProps) {
  const node = useOutlineStore((s) => s.nodes.get(nodeId));
  const nodes = useOutlineStore((s) => s.nodes);
  const schema = useOutlineStore(schemaOf);
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);
  const activeInstanceKey = useOutlineStore((s) => s.activeInstanceKey);
  const selectedNodeId = useOutlineStore((s) => s.selectedNodeId);
  const selectedInstanceKey = useOutlineStore((s) => s.selectedInstanceKey);
  const activateNode = useOutlineStore((s) => s.activateNode);
  const selectNode = useOutlineStore((s) => s.selectNode);
  const toggleCollapse = useOutlineStore((s) => s.toggleCollapse);
  const follow = useFollow();
  const showDebugFields = useDebugFields(nodeId);
  const nodePaletteOpen = useUiStore((s) => s.nodePaletteOpen);
  const filterOpen = useUiStore((s) => s.filterPopoverFrameId === nodeId);

  const instanceKey = instanceKeyProp ?? outlineInstanceKey(nodeId, nodes);

  // The one bullet rule (`bulletClickIntent`), reference rows included: a
  // plain click toggles, a modifier click follows to the node the row shows —
  // for a contextual reference, the original. (Also the guide-line strip's.)
  const handleBulletClick = useCallback(
    (e: React.MouseEvent) => {
      if (bulletClickIntent(e, true) === "follow") {
        follow(nodeTarget(node ? shownNodeId(node) : nodeId), "open");
      } else {
        toggleCollapse(nodeId);
      }
    },
    [toggleCollapse, follow, node, nodeId],
  );

  const handleActivate = useCallback(
    (cursorPos?: number) => {
      activateNode(nodeId, cursorPos, instanceKey);
    },
    [activateNode, nodeId, instanceKey],
  );

  const handleRowSelect = useCallback(
    (e: React.SyntheticEvent) => {
      if (e.target === e.currentTarget) {
        selectNode(nodeId, instanceKey);
      }
    },
    [selectNode, nodeId, instanceKey],
  );

  /** Tana whitespace-create: mint a transient child under this parent. */
  const handleCreateChild = useCallback(() => {
    const lastChild = node?.children[node.children.length - 1] ?? null;
    void mutations.createTransientNode(nodeId, lastChild);
  }, [nodeId, node]);

  const handleKeyDown = useNodeKeyDown({ nodeId, instanceKey });

  const viewConfig = getViewConfig(node?.props);

  // Shared owner: the same rows the visible-instance walk will offer to
  // keyboard navigation.
  const listChildren = useMemo(
    () => (isProjectedViewMode(viewConfig.mode) ? [] : frameListChildren(nodeId, nodes, schema)),
    [nodeId, nodes, schema, viewConfig.mode],
  );

  if (!node) return null;

  const isActive = activeNodeId === nodeId && activeInstanceKey === instanceKey;
  const isSelected = selectedNodeId === nodeId && selectedInstanceKey === instanceKey;
  const isPaletteAnchor =
    nodePaletteOpen &&
    ((selectedNodeId === nodeId && selectedInstanceKey === instanceKey) ||
      (activeNodeId === nodeId && activeInstanceKey === instanceKey));
  const chrome = resolveRowChrome({
    node,
    schema,
    viewConfig,
    isQueryResult: isQueryResultInstance(instanceKey),
    showDebugFields,
  });

  return (
    <div
      className="node-block relative group/frame"
      data-node-block="true"
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
                collapsible={chrome.isExpandable}
                isRef={chrome.bulletIsRef}
                onClick={handleBulletClick}
              />
            }
            content={
              <NodeContent
                node={node}
                instanceKey={instanceKey}
                isActive={isActive}
                tags={node.tags}
                onActivate={handleActivate}
                onKeyDown={handleKeyDown}
              />
            }
          />
        </div>
        {chrome.showToolbar && (
          <div
            className={cn(
              "absolute right-2 transition-opacity z-10",
              filterOpen
                ? "opacity-100"
                : "opacity-0 group-hover/frame:opacity-100 group-focus-within/frame:opacity-100",
            )}
          >
            <ViewToolbar frameId={nodeId} mode={viewConfig.mode} />
          </div>
        )}
      </div>

      {chrome.showsChildContainer && (
        <div className="children-container relative">
          <div
            className="absolute top-0 bottom-2 w-5 cursor-pointer group/line"
            style={guideLineStyle(depth)}
            onClick={handleBulletClick}
          >
            <div className="absolute left-[9px] top-0 bottom-0 w-px bg-foreground/[0.06] group-hover/line:bg-foreground/15 transition-colors duration-200" />
          </div>

          <FieldsSection nodeId={nodeId} depth={depth} />

          {chrome.showsQueryResults && (
            <QueryResultsSection
              nodeId={nodeId}
              depth={depth}
              viewMode={viewConfig.mode}
              frameInstanceKey={instanceKey}
              renderNode={({ nodeId: rid, instanceKey: rInstanceKey, depth: rDepth }) => (
                <NodeBlock
                  key={rInstanceKey}
                  nodeId={rid}
                  instanceKey={rInstanceKey}
                  depth={rDepth}
                />
              )}
            />
          )}

          {chrome.showsChildren &&
            (chrome.projected ? (
              <div style={indentStyle(depth + 1)}>
                <FrameChildrenView frameId={nodeId} frameInstanceKey={instanceKey} />
              </div>
            ) : (
              listChildren.map((child) => {
                const childKey = childInstanceKey(instanceKey, child.id);
                return (
                  <NodeBlock
                    key={childKey}
                    nodeId={child.id}
                    instanceKey={childKey}
                    depth={depth + 1}
                  />
                );
              })
            ))}

          {chrome.showsCreateChild && (
            <div
              data-create-child-zone={nodeId}
              role="button"
              tabIndex={0}
              aria-label="New child node"
              className={cn(
                "group/create relative flex h-6 cursor-pointer items-center rounded-sm",
                "outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              )}
              style={indentStyle(depth + 1)}
              onClick={handleCreateChild}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCreateChild();
                }
              }}
              title="New child node"
            >
              <span
                className="flex h-6 w-6 items-center justify-center text-ui leading-none text-foreground/0 transition-colors duration-150 group-hover/create:text-foreground/25 group-focus-visible/create:text-foreground/25"
                aria-hidden
              >
                +
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
