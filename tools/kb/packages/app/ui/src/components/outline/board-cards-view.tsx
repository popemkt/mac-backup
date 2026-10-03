import { memo, useCallback, useMemo, useState } from "react";
import { mutations } from "@/actions/mutations";
import { shownNode, shownNodeId } from "@/lib/contextual-ref";
import { isReferenceRow } from "@/lib/row-chrome";
import {
  childInstanceKey,
  isQueryResultInstance,
  outlineInstanceKey,
  queryResultInstanceKey,
} from "@/lib/instance-key";
import { useOutlineHost } from "./outline-host";
import { cn } from "@/lib/cn";
import type { NodeMap, OutlineNode, PropValue } from "@/lib/types";
import { frameRows } from "@/lib/frame-rows";
import { EMPTY_GROUP_KEY, resolveTableColumns } from "@/lib/view-config";
import { OutlineBoardView, OutlineCardsView, localIdOf, type ParamsOf } from "@kb/views";
import { fieldContextOf, type FieldContext } from "@/lib/schema";
import { useOutlineStore } from "@/stores/outline.store";
import { useFollow } from "@/stores/follow";
import { bulletClickIntent, nodeTarget } from "@/lib/follow";
import { useDebugFields } from "@/stores/debug-fields.store";
import { usePrefsStore } from "@/stores/prefs.store";
import { Bullet } from "./bullet";
import { NodeField } from "./fields-section";
import { NodeContent } from "./node-content";
import { NodeRow } from "./node-row";
import { TagChipGroup } from "./tag-chip";
import { useNodeKeyDown } from "./use-node-keydown";

/**
 * The two column views over one component: the board groups its cards into a
 * column per value of the field its params name, the cards view shows them
 * all in one grid.
 */
type ColumnsView =
  | { readonly key: typeof OutlineBoardView; readonly params: ParamsOf<typeof OutlineBoardView> }
  | { readonly key: typeof OutlineCardsView; readonly params: ParamsOf<typeof OutlineCardsView> };

interface BoardCardsViewProps {
  frameId: string;
  /** Which of the two views, with the settings it reads (`frameViewOf`). */
  view: ColumnsView;
  frameInstanceKey?: string | undefined;
  nodes?: NodeMap;
  /** What field values resolve against (`fieldContextOf`); the store's by default. */
  context?: FieldContext;
  /** Query-result row ids (overrides frame children). */
  rowIds?: readonly string[] | undefined;
  isQuerySource?: boolean;
  widthPref?: "centered" | "full";
}

export function BoardCardsView({
  frameId,
  view,
  frameInstanceKey,
  nodes: nodesProp,
  context: contextProp,
  rowIds,
  isQuerySource = false,
  widthPref: widthPrefProp,
}: BoardCardsViewProps) {
  const generation = useOutlineStore((s) => s.index?.generation ?? 0);
  const storeNodes = useOutlineStore((s) => s.nodes);
  const nodes = useMemo(
    () => nodesProp ?? storeNodes,
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- generation gates store map identity; the props path uses nodesProp
    [nodesProp, storeNodes, generation],
  );
  const frameNode = nodes.get(frameId);
  // Same rule as the table: displayed columns belong to the frame.
  const debugColumns = useDebugFields(frameId);
  const storeWidth = usePrefsStore((s) => s.width);
  const widthPref = widthPrefProp ?? storeWidth;

  const host = useOutlineHost();
  const baseInstanceKey = frameInstanceKey ?? outlineInstanceKey(frameId, nodes, host);

  // Column names and every field shown are schema, read from the whole graph
  // (`lib/schema.ts`), whatever projection the rows come from.
  const storeContext = useOutlineStore(fieldContextOf);
  const context = contextProp ?? storeContext;
  const schema = context.schema;

  // Grouping and order come from the shared owner: board columns and the flat
  // nav order are two views of one computation.
  const rows = useMemo(
    () => frameRows({ frameId, nodes, schema, view, rowIds }),
    [frameId, nodes, schema, view, rowIds],
  );
  const sorted = rows.ordered;
  const columns = rows.columns;
  const groupFieldId = rows.groupFieldId;
  const mode = localIdOf(view.key);

  const displayCols = useMemo(
    () => resolveTableColumns(view.params, sorted, schema, debugColumns),
    [view.params, sorted, schema, debugColumns],
  );

  const instanceKeyFor = useCallback(
    (nodeId: string) =>
      isQuerySource
        ? queryResultInstanceKey(frameId, nodeId)
        : childInstanceKey(baseInstanceKey, nodeId),
    [isQuerySource, frameId, baseInstanceKey],
  );

  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const handleCardDragStart = useCallback((id: string) => {
    setDragNodeId(id);
  }, []);
  const handleCardDragEnd = useCallback(() => {
    setDragNodeId(null);
  }, []);

  const handleDropOnColumn = useCallback(
    (columnKey: string, columnValue: PropValue | null) => {
      if (dragNodeId === null || groupFieldId === null || isQuerySource) return;
      const node = nodes.get(dragNodeId);
      if (!node) return;
      const oldVal = node.props[groupFieldId]?.[0] ?? null;
      if (columnKey === EMPTY_GROUP_KEY && !oldVal) return;
      if (oldVal && columnValue && JSON.stringify(oldVal) === JSON.stringify(columnValue)) {
        return;
      }
      void mutations.moveBoardCard(dragNodeId, groupFieldId, oldVal, columnValue);
      setDragNodeId(null);
    },
    [dragNodeId, groupFieldId, isQuerySource, nodes],
  );

  if (!frameNode && !rowIds) return null;

  if (view.key === OutlineBoardView && groupFieldId === null) {
    return (
      <div
        className="board-cards-view my-2 rounded-md border border-dashed border-foreground/15 px-3 py-4 text-ui text-foreground/45"
        data-board-cards-view="true"
        data-view-mode="board"
        data-board-empty="true"
        data-frame-id={frameId}
      >
        <p>
          Set <code className="text-foreground/60">view.group</code> to use the board.
        </p>
        <button
          type="button"
          className="mt-2 rounded-md bg-foreground/[0.06] px-2 py-1 text-meta font-medium text-foreground/70 hover:bg-foreground/[0.1]"
          data-switch-to-cards="true"
          onClick={() => void mutations.setFrameView(frameId, OutlineCardsView)}
        >
          Switch to cards
        </button>
      </div>
    );
  }

  const breakout = view.key === OutlineBoardView && widthPref === "centered";

  return (
    <div
      className={cn(
        "board-cards-view my-2",
        view.key === OutlineBoardView && "overflow-x-auto",
        breakout && "table-view-breakout",
      )}
      data-board-cards-view="true"
      data-view-mode={mode}
      data-frame-id={frameId}
      data-breakout={breakout ? "centered" : undefined}
    >
      {view.key === OutlineCardsView ? (
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          }}
          data-cards-grid="true"
        >
          {(columns[0]?.nodes ?? []).map((child) => (
            <ViewCard
              key={instanceKeyFor(child.id)}
              child={child}
              instanceKey={instanceKeyFor(child.id)}
              displayCols={displayCols}
              context={context}
              draggable={false}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-start gap-3 min-w-max pb-2">
          {columns.map((col) => (
            <div
              key={col.key}
              className="w-64 shrink-0 rounded-md border border-foreground/[0.06] bg-foreground/[0.02]"
              data-board-column={col.key}
              onDragOver={(e) => {
                if (isQuerySource || groupFieldId === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDropOnColumn(col.key, col.value);
              }}
            >
              <div className="px-2 py-1.5 text-label font-medium text-foreground/35 border-b border-foreground/[0.06]">
                {col.label || "All"}
                <span className="ml-1 text-foreground/25">{col.nodes.length}</span>
              </div>
              <div className="flex flex-col gap-2 p-2 min-h-16">
                {col.nodes.map((child) => (
                  <ViewCard
                    key={instanceKeyFor(child.id)}
                    child={child}
                    instanceKey={instanceKeyFor(child.id)}
                    displayCols={displayCols}
                    context={context}
                    draggable={!isQuerySource && groupFieldId !== null}
                    onDragStart={handleCardDragStart}
                    onDragEnd={handleCardDragEnd}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const ViewCard = memo(function ViewCard({
  child,
  instanceKey,
  displayCols,
  context,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  child: OutlineNode;
  instanceKey: string;
  displayCols: Array<{ fieldId: string; label: string }>;
  /** What the card's field values resolve against (`fieldContextOf`). */
  context: FieldContext;
  draggable: boolean;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
}) {
  const isActive = useOutlineStore(
    (s) => s.activeNodeId === child.id && s.activeInstanceKey === instanceKey,
  );
  const isSelected = useOutlineStore(
    (s) => s.selectedNodeId === child.id && s.selectedInstanceKey === instanceKey,
  );
  const selectNode = useOutlineStore((s) => s.selectNode);
  const activateNode = useOutlineStore((s) => s.activateNode);
  const follow = useFollow();
  // The card's content is the shown node's (`lib/contextual-ref`); the card is `child`.
  const shown = shownNode(child, context.schema);

  const handleKeyDown = useNodeKeyDown({ nodeId: child.id, instanceKey });

  return (
    <div
      className={cn(
        "view-card rounded-md border border-foreground/[0.06] bg-background p-2",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
      data-view-card="true"
      data-node-id={child.id}
      data-instance-key={instanceKey}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.setData("text/plain", child.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.(child.id);
      }}
      onDragEnd={() => onDragEnd?.()}
    >
      <NodeRow
        depth={0}
        nodeId={child.id}
        instanceKey={instanceKey}
        isSelected={isSelected}
        isActive={isActive}
        onRowClick={() => selectNode(child.id, instanceKey)}
        bullet={
          <Bullet
            node={shown}
            collapsed={child.collapsed}
            collapsible={false}
            isRef={isReferenceRow(child, isQueryResultInstance(instanceKey))}
            onClick={(e) => {
              e.stopPropagation();
              // A card's bullet cannot toggle: its children are not drawn.
              const intent = bulletClickIntent(e, false);
              if (intent !== "toggle") follow(nodeTarget(shownNodeId(child)), intent);
            }}
          />
        }
        content={
          <NodeContent
            node={child}
            instanceKey={instanceKey}
            isActive={isActive}
            tags={[]}
            onActivate={(pos) => activateNode(child.id, pos, instanceKey)}
            onKeyDown={handleKeyDown}
          />
        }
      />
      {shown.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-0.5 pl-1">
          <TagChipGroup
            tags={shown.tags}
            onTagClick={(tag, e) => {
              e.stopPropagation();
              follow(nodeTarget(tag.id), "open");
            }}
          />
        </div>
      )}
      {displayCols.length > 0 && (
        <div className="mt-1 flex flex-col gap-0.5">
          {displayCols.map((col) => (
            <NodeField
              key={col.fieldId}
              depth={-1}
              instanceKey={instanceKey}
              nodeId={shown.id}
              fieldId={col.fieldId}
              label={col.label}
              values={shown.props[col.fieldId] ?? []}
              context={context}
            />
          ))}
        </div>
      )}
    </div>
  );
});
