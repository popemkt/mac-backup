import { memo, useCallback, useMemo } from "react";
import { shownNode } from "@/lib/contextual-ref";
import { cn } from "@/lib/cn";
import { guideLineStyle, indentStyle } from "@/lib/indent";
import { childInstanceKey, outlineInstanceKey } from "@/lib/instance-key";
import { resolveRowChrome } from "@/lib/row-chrome";
import { useUiStore } from "@/stores/ui.store";
import { useDebugFields } from "@/stores/debug-fields.store";
import { schemaOf, type SchemaIndex } from "@/lib/schema";
import type { OutlineNode } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { useFollow } from "@/stores/follow";
import { bulletClickIntent, nodeTarget } from "@/lib/follow";
import { mutations } from "@/actions/mutations";
import { frameRows } from "@/lib/frame-rows";
import type { ViewProps } from "@/lib/plugins";
import type { ParamsOf } from "@/lib/view-key";
import { frameViewOf, projectsRows, type FrameView } from "@/lib/view-config";
import { Bullet } from "./bullet";
import { FieldsSection } from "./fields-section";
import { useFrameSubject } from "./frame-subject";
import { NoFrame } from "./frame-views";
import { FrameViewSlot } from "./frame-view-slot";
import { useFrameViewKeys } from "./use-frame-views";
import { OutlineListView } from "./views";
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

/** The node a row shows (`shownNode`), and its id even before the row's node loads. */
function rowShows(
  nodeId: string,
  node: OutlineNode | undefined,
  schema: SchemaIndex,
): { shown: OutlineNode | undefined; shownId: string } {
  if (!node) return { shown: undefined, shownId: nodeId };
  const shown = shownNode(node, schema);
  return { shown, shownId: shown.id };
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
  // Everything the row draws is its shown node's: for a contextual reference,
  // the target (`lib/contextual-ref`). Its place — selection, collapse, the
  // instance key, the keymaps — stays `nodeId`.
  const { shown, shownId } = rowShows(nodeId, node, schema);
  const showDebugFields = useDebugFields(shownId);
  const nodePaletteOpen = useUiStore((s) => s.nodePaletteOpen);
  const filterOpen = useUiStore((s) => s.filterPopoverFrameId === shownId);

  const instanceKey = instanceKeyProp ?? outlineInstanceKey(nodeId, nodes);

  // The one bullet rule (`bulletClickIntent`), reference rows included: a
  // plain click toggles, a modifier click follows to the node the row shows —
  // for a contextual reference, the original. (Also the guide-line strip's.)
  const handleBulletClick = useCallback(
    (e: React.MouseEvent) => {
      if (bulletClickIntent(e, true) === "follow") {
        follow(nodeTarget(shownId), "open");
      } else {
        toggleCollapse(nodeId);
      }
    },
    [toggleCollapse, follow, shownId, nodeId],
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

  const handleKeyDown = useNodeKeyDown({ nodeId, instanceKey });

  // The view the shown node's children are shown in: the frame is the shown node.
  const frameViews = useFrameViewKeys();
  const frameView = useMemo(
    () => frameViewOf(shown?.props, frameViews),
    [shown?.props, frameViews],
  );
  const frameViewKey = frameView?.key ?? null;

  if (!node || !shown) return null;

  const isActive = activeNodeId === nodeId && activeInstanceKey === instanceKey;
  const isSelected = selectedNodeId === nodeId && selectedInstanceKey === instanceKey;
  const isPaletteAnchor =
    nodePaletteOpen &&
    ((selectedNodeId === nodeId && selectedInstanceKey === instanceKey) ||
      (activeNodeId === nodeId && activeInstanceKey === instanceKey));
  const chrome = resolveRowChrome({
    node,
    schema,
    view: frameViewKey,
    instanceKey,
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
                node={shown}
                collapsed={node.collapsed}
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
                tags={shown.tags}
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
            <ViewToolbar frameId={shownId} view={frameViewKey} />
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

          <FieldsSection nodeId={shownId} depth={depth} instanceKey={instanceKey} />

          {chrome.showsQueryResults && (
            <QueryResultsSection
              nodeId={shownId}
              depth={depth}
              view={frameViewKey}
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

          {chrome.showsChildren && (
            <FrameChildren
              frameId={shownId}
              instanceKey={instanceKey}
              depth={depth + 1}
              view={frameView}
            />
          )}

          {chrome.showsCreateChild && <CreateChildStrip parentId={shownId} depth={depth} />}
        </div>
      )}
    </div>
  );
});

/**
 * Tana whitespace-create: the strip under a row's children mints a transient
 * child, last, under `parentId` — the node the row shows.
 */
function CreateChildStrip({ parentId, depth }: { parentId: string; depth: number }) {
  const handleCreateChild = useCallback(() => {
    const parent = useOutlineStore.getState().nodes.get(parentId);
    const lastChild = parent?.children.at(-1) ?? null;
    void mutations.createTransientNode(parentId, lastChild);
  }, [parentId]);

  return (
    <div
      data-create-child-zone={parentId}
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
  );
}

/**
 * What a row shows under itself: a list continues as rows here; any other view
 * is embedded in a slot, indented as one block.
 */
function FrameChildren({
  frameId,
  instanceKey,
  depth,
  view,
}: {
  readonly frameId: string;
  readonly instanceKey: string;
  readonly depth: number;
  readonly view: FrameView | null;
}) {
  if (view !== null && !projectsRows(view.key))
    return <ListRows frameId={frameId} instanceKey={instanceKey} depth={depth} view={view} />;
  return (
    <div style={indentStyle(depth)}>
      <FrameViewSlot frameId={frameId} instanceKey={instanceKey} depth={depth} />
    </div>
  );
}

/**
 * The list view's rows: a frame's children as outline rows, each one hosting
 * its own children in turn — the same rows the visible-instance walk offers
 * keyboard navigation. A row whose frame is also a list continues this list
 * here rather than embedding the list view again in a slot: a list nests as
 * deep as the outline does, bounded by the tree, while the slot's depth budget
 * is for one view embedding another.
 */
function ListRows({
  frameId,
  instanceKey,
  depth,
  view,
}: {
  readonly frameId: string;
  /** The frame's render instance; at the outline's root, each row takes its canonical one. */
  readonly instanceKey: string | undefined;
  readonly depth: number;
  readonly view: FrameView;
}) {
  const nodes = useOutlineStore((s) => s.nodes);
  const schema = useOutlineStore(schemaOf);
  const rows = useMemo(
    () => frameRows({ frameId, nodes, schema, view }).rendered,
    [frameId, nodes, schema, view],
  );
  return rows.map((child) => {
    const key =
      instanceKey === undefined
        ? outlineInstanceKey(child.id, nodes)
        : childInstanceKey(instanceKey, child.id);
    return <NodeBlock key={key} nodeId={child.id} instanceKey={key} depth={depth} />;
  });
}

/** The list view: a frame's children as the outline shows them, nested. */
export function ListFrameView({ params }: ViewProps<ParamsOf<typeof OutlineListView>>) {
  const subject = useFrameSubject();
  const view = useMemo(() => ({ key: OutlineListView, params }), [params]);
  if (subject === null) return <NoFrame />;
  return (
    <ListRows
      frameId={subject.frameId}
      instanceKey={subject.instanceKey}
      depth={subject.depth}
      view={view}
    />
  );
}
