import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  browserHost,
  Bullet,
  bulletClickIntent,
  childInstanceKey,
  cn,
  type FieldContext,
  frameRows,
  type FrameSubject,
  type NodeMap,
  NodeRow,
  nodeTarget,
  outlineHostOfPane,
  outlineInstanceKey,
  type OutlineNode,
  queryResultInstanceKey,
  resolveRowChrome,
  resolveTableColumns,
  shownNode,
  shownNodeId,
  SYSTEM_IDS,
  type TableColumnSpec,
  useDebugFields,
  useFollow,
  useFrameView,
  useGraphRead,
  useIsActive,
  useIsSelected,
  usePane,
  usePrefs,
} from "@kb/ui-sdk";
import { type SortSpec, type ParamsOf, OutlineTableView } from "@kb/views";

/** The Name column is the node-text field, so sorting by it names a node like any other column. */
const NAME_COLUMN = SYSTEM_IDS.nodeTextField;

interface TableViewProps {
  /** The frame the table lays out, and what its host draws each row with. */
  frame: FrameSubject;
  /** The settings the table reads, decoded from the frame (`frameViewOf`). */
  settings: ParamsOf<typeof OutlineTableView>;
  nodes?: NodeMap;
  /** What field values resolve against (`fieldContextOf`); the page's graph by default. */
  context?: FieldContext;
  /** Test/override hook — defaults to prefs store width. */
  widthPref?: "centered" | "full";
}

export function TableView({
  frame,
  settings,
  nodes: nodesProp,
  context: contextProp,
  widthPref: widthPrefProp,
}: TableViewProps) {
  const {
    frameId,
    instanceKey: frameInstanceKey,
    rowIds,
    isQuerySource,
    pages,
    revealMorePages,
    RowText,
    Field,
  } = frame;
  const graph = useGraphRead();
  const nodes = nodesProp ?? graph.outline;
  const frameNode = nodes.get(frameId);
  // Columns are a property of the FRAME, not of any row: one header serves
  // every row, so the frame node is the only thing "per-node" can mean here.
  const debugColumns = useDebugFields(frameId);
  const storeWidth = usePrefs((prefs) => prefs.width);
  const widthPref = widthPrefProp ?? storeWidth;

  const host = outlineHostOfPane(usePane());
  const baseInstanceKey = frameInstanceKey ?? outlineInstanceKey(frameId, nodes, host);

  // Column names and every field shown are schema, read from the whole graph
  // (`lib/schema.ts`), whatever projection the rows come from.
  const context = contextProp ?? graph;
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
        void browserHost().writes.setColumnWidth(frameId, colId, finalWidth);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [frameId],
  );

  const handleHeaderSortClick = useCallback(
    (fieldId: string) => {
      void browserHost().writes.toggleViewSort(frameId, fieldId);
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
                RowText={RowText}
                Field={Field}
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
            onClick={revealMorePages}
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
  RowText,
  Field,
}: {
  child: OutlineNode;
  childKey: string;
  columns: TableColumnSpec[];
  context: FieldContext;
  RowText: FrameSubject["RowText"];
  Field: FrameSubject["Field"];
}) {
  const isActive = useIsActive(child.id, childKey);
  const isSelected = useIsSelected(child.id, childKey);
  const follow = useFollow();
  // The cells are the shown node's (`lib/contextual-ref`); the row is `child`.
  const shown = shownNode(child, context.schema);
  const shownView = useFrameView(shown);
  const rowDebug = useDebugFields(shown.id);

  // A row's own field rows follow the row's own flag — the frame's debug
  // columns say nothing about whether this node reveals its sys.* props.
  const chrome = resolveRowChrome({
    node: child,
    schema: context.schema,
    view: shownView?.key ?? null,
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
          onRowClick={() => browserHost().selectNode(child.id, childKey)}
          bullet={
            <Bullet
              node={shown}
              collapsed={child.collapsed}
              collapsible={chrome.isExpandable}
              isRef={chrome.bulletIsRef}
              onClick={(e) => {
                const intent = bulletClickIntent(e, true);
                if (intent === "toggle") browserHost().toggleCollapse(child.id);
                else follow(nodeTarget(shownNodeId(child)), intent);
              }}
            />
          }
          content={
            <RowText node={child} instanceKey={childKey} isActive={isActive} tags={shown.tags} />
          }
        />
      </td>

      {columns.map((col) => (
        <td key={col.fieldId} className="px-2 py-1 align-top">
          <Field
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
