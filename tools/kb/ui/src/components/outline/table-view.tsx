import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { mutations } from "@/actions/mutations";
import { formatPropValue, resolveProps } from "@/lib/graph-view";
import {
  childInstanceKey,
  outlineInstanceKey,
  queryResultInstanceKey,
} from "@/lib/instance-key";
import {
  emptyValueForType,
  isValueMismatch,
  resolveAllowedRefIdsCached,
  resolveFieldTypeById,
} from "@/lib/field-type";
import { cn } from "@/lib/cn";
import { isQueryNode } from "@/lib/query-node";
import type { NodeMap, OutlineNode, PropValue } from "@/lib/types";
import { frameRows } from "@/lib/frame-rows";
import {
  getViewConfig,
  resolveTableColumns,
  type SortSpec,
  type TableColumnSpec,
} from "@/lib/view-config";
import { useDebugFields } from "@/stores/debug-fields.store";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore } from "@/stores/prefs.store";
import { Bullet } from "./bullet";
import { FieldRow } from "./field-row";
import { PropValueEditor } from "./field-value";
import { NodeContent } from "./node-content";
import { NodeRow } from "./node-row";
import { useNodeKeyDown } from "./use-node-keydown";

interface TableViewProps {
  frameId: string;
  frameInstanceKey?: string;
  nodes?: NodeMap;
  /** Test/override hook — defaults to prefs store width. */
  widthPref?: "centered" | "full";
  /** Query-result row ids (overrides frame children). */
  rowIds?: string[];
  isQuerySource?: boolean;
}

export function TableView({
  frameId,
  frameInstanceKey,
  nodes: nodesProp,
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

  const baseInstanceKey =
    frameInstanceKey ?? outlineInstanceKey(frameId, nodes);

  const viewConfig = useMemo(
    () => getViewConfig(frameNode?.props),
    [frameNode?.props],
  );

  const pages = useOutlineStore((s) => s.framePages[frameId] ?? 1);
  const revealMorePages = useOutlineStore((s) => s.revealMorePages);

  // Row order and pagination come from the shared owner, so the rows rendered
  // here are exactly the rows keyboard navigation can reach.
  const rows = useMemo(
    () => frameRows({ frameId, nodes, rowIds, pages }),
    [frameId, nodes, rowIds, pages],
  );

  const columns = useMemo(
    () => resolveTableColumns(viewConfig, rows.ordered, nodes, debugColumns),
    [viewConfig, rows.ordered, nodes, debugColumns],
  );

  const displayedChildren = rows.rendered;
  const hasMore = rows.hasMore;

  const [localColwidth, setLocalColwidth] = useState<Record<string, number>>(
    {},
  );
  const [resizing, setResizing] = useState<string | null>(null);

  useEffect(() => {
    if (!resizing) {
      setLocalColwidth(viewConfig.colwidth);
    }
  }, [viewConfig.colwidth, resizing]);

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
      <table
        className="w-full text-left border-collapse"
        style={{ minWidth: "max-content" }}
      >
        <thead>
          <tr className="border-b border-foreground/[0.06] bg-foreground/[0.02]">
            <th
              className="group relative px-2 py-1.5 text-[11px] font-medium text-foreground/35 select-none"
              style={{
                width: `${localColwidth["__name__"] ?? viewConfig.colwidth["__name__"] ?? 220}px`,
              }}
            >
              <div
                className="flex items-center gap-1 cursor-pointer hover:text-foreground/70"
                onClick={() => handleHeaderSortClick("__name__")}
              >
                <span>Name</span>
                <SortIndicator sort={viewConfig.sort} fieldId="__name__" />
              </div>
              <ResizeHandle
                onMouseDown={(e) =>
                  handleResizeStart(
                    "__name__",
                    localColwidth["__name__"] ??
                      viewConfig.colwidth["__name__"] ??
                      220,
                    e,
                  )
                }
              />
            </th>

            {columns.map((col) => {
              const currentWidth =
                localColwidth[col.fieldId] ??
                viewConfig.colwidth[col.fieldId] ??
                160;
              return (
                <th
                  key={col.fieldId}
                  className="group relative px-2 py-1.5 text-[11px] font-medium text-foreground/35 select-none"
                  style={{ width: `${currentWidth}px` }}
                >
                  <div
                    className="flex items-center gap-1 cursor-pointer hover:text-foreground/70"
                    onClick={() => handleHeaderSortClick(col.fieldId)}
                  >
                    <span className="truncate">{col.label}</span>
                    <SortIndicator
                      sort={viewConfig.sort}
                      fieldId={col.fieldId}
                    />
                  </div>
                  <ResizeHandle
                    onMouseDown={(e) =>
                      handleResizeStart(col.fieldId, currentWidth, e)
                    }
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
                nodes={nodes}
                isRef={isQuerySource}
              />
            );
          })}
        </tbody>
      </table>

      {hasMore && (
        <div className="p-2 border-t border-foreground/[0.06] text-center">
          <button
            type="button"
            className="text-[11px] text-foreground/50 hover:text-foreground/80 font-medium px-3 py-1 rounded bg-foreground/[0.04] hover:bg-foreground/[0.08] cursor-pointer"
            onClick={() => revealMorePages(frameId)}
          >
            Show more ({rows.ordered.length - displayedChildren.length}{" "}
            remaining)
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
  nodes,
  isRef = false,
}: {
  child: OutlineNode;
  childKey: string;
  columns: TableColumnSpec[];
  nodes: NodeMap;
  isRef?: boolean;
}) {
  const isActive = useOutlineStore(
    (s) => s.activeNodeId === child.id && s.activeInstanceKey === childKey,
  );
  const isSelected = useOutlineStore(
    (s) =>
      s.selectedNodeId === child.id && s.selectedInstanceKey === childKey,
  );
  const selectNode = useOutlineStore((s) => s.selectNode);
  const activateNode = useOutlineStore((s) => s.activateNode);
  const toggleCollapse = useOutlineStore((s) => s.toggleCollapse);
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const rowDebug = useDebugFields(child.id);

  const handleKeyDown = useNodeKeyDown({
    nodeId: child.id,
    instanceKey: childKey,
    node: child,
    isRef,
  });

  const isQuery = isQueryNode(child);
  // A row's own field rows follow the row's own flag — the frame's debug
  // columns say nothing about whether this node reveals its sys.* props.
  const hasFields =
    resolveProps(child, nodes, { showDebugFields: rowDebug }).length > 0;
  const isExpandable =
    child.children.length > 0 || isQuery || hasFields;

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
          onRowClick={() => {
            if (isRef) zoomTo(child.id);
            else selectNode(child.id, childKey);
          }}
          bullet={
            <Bullet
              node={child}
              collapsible={isExpandable && !isRef}
              isRef={isRef}
              onClick={(e) => {
                if (isRef || e.metaKey || e.ctrlKey) zoomTo(child.id);
                else toggleCollapse(child.id);
              }}
            />
          }
          content={
            <NodeContent
              nodeId={child.id}
              instanceKey={childKey}
              content={child.text}
              isActive={isActive}
              tags={child.tags}
              onActivate={(pos) => activateNode(child.id, pos, childKey)}
              onChange={(text) => mutations.updateNodeContent(child.id, text)}
              onKeyDown={handleKeyDown}
            />
          }
        />
      </td>

      {columns.map((col) => (
        <td key={col.fieldId} className="px-2 py-1 align-top">
          <TableCellField
            nodeId={child.id}
            fieldId={col.fieldId}
            values={child.props[col.fieldId] ?? []}
            nodes={nodes}
          />
        </td>
      ))}
    </tr>
  );
});

function SortIndicator({
  sort,
  fieldId,
}: {
  sort: SortSpec[];
  fieldId: string;
}) {
  const spec = sort.find((s) => s.fieldId === fieldId);
  if (!spec) return null;
  return (
    <span className="text-[9px] font-bold text-foreground/70">
      {spec.dir === "asc" ? "▲" : "▼"}
    </span>
  );
}

function ResizeHandle({
  onMouseDown,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize opacity-0 group-hover:opacity-100 flex items-center justify-center"
      onMouseDown={onMouseDown}
    >
      <div className="w-0.5 h-3 bg-foreground/20 rounded-full" />
    </div>
  );
}

const TableCellField = memo(function TableCellField({
  nodeId,
  fieldId,
  values,
  nodes,
}: {
  nodeId: string;
  fieldId: string;
  values: PropValue[];
  nodes: NodeMap;
}) {
  const queryDb = useOutlineStore((s) => s.queryDb);
  const fieldType = resolveFieldTypeById(fieldId, nodes);
  // Ref-target cache keys on rev; only subscribe when field is ref-typed.
  const rev = useOutlineStore((s) => (fieldType === "ref" ? s.rev : 0));

  const fieldNode = nodes.get(fieldId);
  const allowedRefIds =
    fieldType === "ref"
      ? resolveAllowedRefIdsCached(fieldId, fieldNode, nodes, queryDb, rev)
      : null;

  const label = fieldNode?.text || fieldId;

  if (values.length === 0) {
    const emptyVal = emptyValueForType(fieldType);
    return (
      <FieldRow
        valueOnly
        fieldType={fieldType}
        fieldId={fieldId}
        label={label}
      >
        <PropValueEditor
          value={emptyVal}
          display=""
          fieldType={fieldType}
          allowedRefIds={allowedRefIds}
          nodes={nodes}
          onCommit={(next: PropValue) =>
            void mutations.updateProp(nodeId, fieldId, next)
          }
        />
      </FieldRow>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {values.map((v, i) => (
        <FieldRow
          key={`${fieldId}-${i}`}
          valueOnly
          fieldType={fieldType}
          fieldId={fieldId}
          label={label}
          mismatch={isValueMismatch(fieldType, v)}
        >
          <PropValueEditor
            value={v}
            display={formatPropValue(v, nodes)}
            fieldType={fieldType}
            allowedRefIds={allowedRefIds}
            nodes={nodes}
            onCommit={(next: PropValue) =>
              void mutations.updateProp(nodeId, fieldId, next, v)
            }
          />
        </FieldRow>
      ))}
    </div>
  );
});
