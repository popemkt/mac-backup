import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { mutations } from "@/actions/mutations";
import { shownNode, shownNodeId } from "@/lib/contextual-ref";
import { resolveRowChrome } from "@/lib/row-chrome";
import { childInstanceKey, outlineInstanceKey, queryResultInstanceKey } from "@/lib/instance-key";
import { cn } from "@/lib/cn";
import { SYSTEM_IDS, type NodeMap, type OutlineNode } from "@/lib/types";
import { frameRows } from "@/lib/frame-rows";
import {
  OutlineTableView,
  frameViewOf,
  resolveTableColumns,
  type SortSpec,
  type TableColumnSpec,
} from "@/lib/view-config";
import type { ParamsOf } from "@/lib/plugins";
import { useDebugFields } from "@/stores/debug-fields.store";
import { fieldContextOf, type FieldContext } from "@/lib/schema";
import { useOutlineStore } from "@/stores/outline.store";
import { useFollow } from "@/stores/follow";
import { bulletClickIntent, nodeTarget } from "@/lib/follow";
import { usePrefsStore } from "@/stores/prefs.store";
import { Bullet } from "./bullet";
import { NodeField } from "./fields-section";
import { NodeContent } from "./node-content";
import { NodeRow } from "./node-row";
import { useNodeKeyDown } from "./use-node-keydown";

/** The Name column is the node-text field, so sorting by it names a node like any other column. */
const NAME_COLUMN = SYSTEM_IDS.nodeTextField;

interface TableViewProps {
  frameId: string;
  /** The settings the table reads, decoded from the frame (`frameViewOf`). */
  settings: ParamsOf<typeof OutlineTableView>;
  frameInstanceKey?: string | undefined;
  nodes?: NodeMap;
  /** What field values resolve against (`fieldContextOf`); the store's by default. */
  context?: FieldContext;
  /** Test/override hook — defaults to prefs store width. */
  widthPref?: "centered" | "full";
  /** Query-result row ids (overrides frame children). */
  rowIds?: readonly string[] | undefined;
  isQuerySource?: boolean;
}

export function TableView({
  frameId,
  settings,
  frameInstanceKey,
  nodes: nodesProp,
  context: contextProp,
  widthPref: widthPrefProp,
  rowIds,
  isQuerySource = false,
}: TableViewProps) {
  const storeNodes = useOutlineStore((s) => s.nodes);
  const nodes = nodesProp ?? storeNodes;
  const frameNode = nodes.get(frameId);
  // Columns are a property of the FRAME, not of any row: one header serves
  // every row, so the frame node is the only thing "per-node" can mean here.
  const debugColumns = useDebugFields(frameId);
  const storeWidth = usePrefsStore((s) => s.width);
  const widthPref = widthPrefProp ?? storeWidth;

  const baseInstanceKey = frameInstanceKey ?? outlineInstanceKey(frameId, nodes);

  const pages = useOutlineStore((s) => s.framePages[frameId] ?? 1);
  const revealMorePages = useOutlineStore((s) => s.revealMorePages);

  // Column names and every field shown are schema, read from the whole graph
  // (`lib/schema.ts`), whatever projection the rows come from.
  const storeContext = useOutlineStore(fieldContextOf);
  const context = contextProp ?? storeContext;
  const schema = context.schema;

  // Row order and pagination come from the shared owner, so the rows rendered
  // here are exactly the rows keyboard navigation can reach.
  const rows = useMemo(
    () =>
      frameRows({
        frameId,
        nodes,
        schema,
        view: { key: OutlineTableView, params: settings },
        rowIds,
        pages,
      }),
    [frameId, nodes, schema, settings, rowIds, pages],
  );
  const columns = useMemo(
    () => resolveTableColumns(settings, rows.ordered, schema, debugColumns),
    [settings, rows.ordered, schema, debugColumns],
  );

  const displayedChildren = rows.rendered;
  const hasMore = rows.hasMore;

  const [localColwidth, setLocalColwidth] = useState<Record<string, number>>({});
  const [resizing, setResizing] = useState<string | null>(null);

  useEffect(() => {
    if (resizing === null) {
      setLocalColwidth(settings.colwidth);
    }
  }, [settings.colwidth, resizing]);

  const handleResizeStart = useCallback(
    (colId: string, initialWidth: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setResizing(colId);

      const startX = e.clientX;

      const handleMouseMove = (me: MouseEvent) => {
        const delta = me.clientX - startX;
        const newWidth = Math.max(60, initialWidth + delta);
        setLocalColwidth((prev) => ({ ...prev, [colId]: newWidth }));
      };

      const handleMouseUp = (me: MouseEvent) => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        const delta = me.clientX - startX;
        const finalWidth = Math.max(60, initialWidth + delta);
        setResizing(null);
        void mutations.setColumnWidth(frameId, colId, finalWidth);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [frameId],
  );

  const handleHeaderSortClick = useCallback(
    (fieldId: string) => {
      void mutations.toggleViewSort(frameId, fieldId);
    },
    [frameId],
  );

  if (!frameNode && !rowIds) return null;

  const breakoutCentered = widthPref === "centered";

  return (
    <div
      className={cn(
        "table-view kb-text w-full overflow-x-auto my-2 rounded-md border border-foreground/[0.06] bg-background",
        breakoutCentered && "table-view-breakout",
      )}
      data-table-view="true"
      data-frame-id={frameId}
      data-breakout={breakoutCentered ? "centered" : undefined}
    >
      <table className="w-full text-left border-collapse" style={{ minWidth: "max-content" }}>
        <thead>
          <tr className="border-b border-foreground/[0.06] bg-foreground/[0.02]">
            <th
              className="group relative px-2 py-1.5 text-label font-medium text-foreground/35 select-none"
              style={{
                width: `${localColwidth[NAME_COLUMN] ?? settings.colwidth[NAME_COLUMN] ?? 220}px`,
              }}
            >
              <div
                className="flex items-center gap-1 cursor-pointer hover:text-foreground/70"
                onClick={() => handleHeaderSortClick(NAME_COLUMN)}
              >
                <span>Name</span>
                <SortIndicator sort={settings.sort} fieldId={NAME_COLUMN} />
              </div>
              <ResizeHandle
                onMouseDown={(e) =>
                  handleResizeStart(
                    NAME_COLUMN,
                    localColwidth[NAME_COLUMN] ?? settings.colwidth[NAME_COLUMN] ?? 220,
                    e,
                  )
                }
              />
            </th>

            {columns.map((col) => {
              const currentWidth =
                localColwidth[col.fieldId] ?? settings.colwidth[col.fieldId] ?? 160;
              return (
                <th
                  key={col.fieldId}
                  className="group relative px-2 py-1.5 text-label font-medium text-foreground/35 select-none"
                  style={{ width: `${currentWidth}px` }}
                >
                  <div
                    className="flex items-center gap-1 cursor-pointer hover:text-foreground/70"
                    onClick={() => handleHeaderSortClick(col.fieldId)}
                  >
                    <span className="truncate">{col.label}</span>
                    <SortIndicator sort={settings.sort} fieldId={col.fieldId} />
                  </div>
                  <ResizeHandle
                    onMouseDown={(e) => handleResizeStart(col.fieldId, currentWidth, e)}
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {displayedChildren.map((child) => {
            const childKey = isQuerySource
              ? queryResultInstanceKey(frameId, child.id)
              : childInstanceKey(baseInstanceKey, child.id);
            return (
              <TableRow
                key={childKey}
                child={child}
                childKey={childKey}
                columns={columns}
                context={context}
              />
            );
          })}
        </tbody>
      </table>

      {hasMore && (
        <div className="p-2 border-t border-foreground/[0.06] text-center">
          <button
            type="button"
            className="text-label text-foreground/50 hover:text-foreground/80 font-medium px-3 py-1 rounded-xs bg-foreground/[0.04] hover:bg-foreground/[0.08] cursor-pointer"
            onClick={() => revealMorePages(frameId)}
          >
            Show more ({rows.ordered.length - displayedChildren.length} remaining)
          </button>
        </div>
      )}
    </div>
  );
}

const TableRow = memo(function TableRow({
  child,
  childKey,
  columns,
  context,
}: {
  child: OutlineNode;
  childKey: string;
  columns: TableColumnSpec[];
  context: FieldContext;
}) {
  const isActive = useOutlineStore(
    (s) => s.activeNodeId === child.id && s.activeInstanceKey === childKey,
  );
  const isSelected = useOutlineStore(
    (s) => s.selectedNodeId === child.id && s.selectedInstanceKey === childKey,
  );
  const selectNode = useOutlineStore((s) => s.selectNode);
  const activateNode = useOutlineStore((s) => s.activateNode);
  const toggleCollapse = useOutlineStore((s) => s.toggleCollapse);
  const follow = useFollow();
  // The cells are the shown node's (`lib/contextual-ref`); the row is `child`.
  const shown = shownNode(child, context.schema);
  const rowDebug = useDebugFields(shown.id);

  const handleKeyDown = useNodeKeyDown({ nodeId: child.id, instanceKey: childKey });

  // A row's own field rows follow the row's own flag — the frame's debug
  // columns say nothing about whether this node reveals its sys.* props.
  const chrome = resolveRowChrome({
    node: child,
    schema: context.schema,
    view: frameViewOf(shown.props).key,
    instanceKey: childKey,
    showDebugFields: rowDebug,
  });

  return (
    <tr
      className="border-b border-foreground/[0.03] hover:bg-foreground/[0.02] transition-colors"
      data-node-id={child.id}
      data-instance-key={childKey}
    >
      <td className="px-1 py-0.5 align-top">
        <NodeRow
          depth={0}
          nodeId={child.id}
          instanceKey={childKey}
          isSelected={isSelected}
          isActive={isActive}
          onRowClick={() => selectNode(child.id, childKey)}
          bullet={
            <Bullet
              node={shown}
              collapsed={child.collapsed}
              collapsible={chrome.isExpandable}
              isRef={chrome.bulletIsRef}
              onClick={(e) => {
                if (bulletClickIntent(e, true) === "follow") {
                  follow(nodeTarget(shownNodeId(child)), "open");
                } else toggleCollapse(child.id);
              }}
            />
          }
          content={
            <NodeContent
              node={child}
              instanceKey={childKey}
              isActive={isActive}
              tags={shown.tags}
              onActivate={(pos) => activateNode(child.id, pos, childKey)}
              onKeyDown={handleKeyDown}
            />
          }
        />
      </td>

      {columns.map((col) => (
        <td key={col.fieldId} className="px-2 py-1 align-top">
          <NodeField
            valueOnly
            instanceKey={childKey}
            nodeId={shown.id}
            fieldId={col.fieldId}
            label={col.label}
            values={shown.props[col.fieldId] ?? []}
            context={context}
          />
        </td>
      ))}
    </tr>
  );
});

function SortIndicator({ sort, fieldId }: { sort: readonly SortSpec[]; fieldId: string }) {
  const spec = sort.find((s) => s.fieldId === fieldId);
  if (!spec) return null;
  return (
    <span className="text-micro font-bold text-foreground/70">
      {spec.dir === "asc" ? "▲" : "▼"}
    </span>
  );
}

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize opacity-0 group-hover:opacity-100 flex items-center justify-center"
      onMouseDown={onMouseDown}
    >
      <div className="w-0.5 h-3 bg-foreground/20 rounded-full" />
    </div>
  );
}
