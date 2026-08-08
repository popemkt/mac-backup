import { useCallback, useEffect, useMemo, useState } from "react";
import { mutations } from "@/actions/mutations";
import { formatPropValue, resolveProps } from "@/lib/graph-view";
import { childInstanceKey, outlineInstanceKey } from "@/lib/instance-key";
import {
  emptyValueForType,
  resolveAllowedRefIdsCached,
  resolveFieldTypeById,
} from "@/lib/field-type";
import { isQueryNode } from "@/lib/query-node";
import type { NodeMap, OutlineNode, PropValue } from "@/lib/types";
import {
  getViewConfig,
  resolveTableColumns,
  sortChildrenForTable,
} from "@/lib/view-config";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore } from "@/stores/prefs.store";
import { Bullet } from "./bullet";
import { PropValueEditor } from "./field-value";
import { NodeContent } from "./node-content";
import { NodeRow } from "./node-row";

interface TableViewProps {
  frameId: string;
  frameInstanceKey?: string;
  nodes?: NodeMap;
}

export function TableView({
  frameId,
  frameInstanceKey,
  nodes: nodesProp,
}: TableViewProps) {
  const storeNodes = useOutlineStore((s) => s.nodes);
  const nodes = nodesProp ?? storeNodes;
  const frameNode = nodes.get(frameId);
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

  const baseInstanceKey =
    frameInstanceKey ?? outlineInstanceKey(frameId, nodes);

  const viewConfig = useMemo(
    () => getViewConfig(frameNode?.props),
    [frameNode?.props],
  );

  const children = useMemo(() => {
    if (!frameNode) return [];
    return frameNode.children
      .map((id) => nodes.get(id))
      .filter((n): n is OutlineNode => n !== undefined);
  }, [frameNode, nodes]);

  const columns = useMemo(
    () => resolveTableColumns(viewConfig, children, nodes, showAllFields),
    [viewConfig, children, nodes, showAllFields],
  );

  const sortedChildren = useMemo(
    () => sortChildrenForTable(children, viewConfig.sort, nodes),
    [children, viewConfig.sort, nodes],
  );

  const [visibleLimit, setVisibleLimit] = useState(viewConfig.pagesize);

  useEffect(() => {
    setVisibleLimit(viewConfig.pagesize);
  }, [viewConfig.pagesize]);

  const displayedChildren = useMemo(
    () => sortedChildren.slice(0, visibleLimit),
    [sortedChildren, visibleLimit],
  );

  const hasMore = sortedChildren.length > visibleLimit;

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

  if (!frameNode) return null;

  return (
    <div
      className="table-view w-full overflow-x-auto my-2 rounded-md border border-foreground/[0.06] bg-background text-[14.5px] leading-[1.6]"
      data-table-view="true"
      data-frame-id={frameId}
    >
      <table
        className="w-full text-left border-collapse"
        style={{ minWidth: "max-content" }}
      >
        <thead>
          <tr className="border-b border-foreground/[0.06] bg-foreground/[0.02]">
            {/* Name Column */}
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

            {/* Field Columns */}
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
            const childKey = childInstanceKey(baseInstanceKey, child.id);
            const isActive =
              activeNodeId === child.id && activeInstanceKey === childKey;
            const isSelected =
              selectedNodeId === child.id && selectedInstanceKey === childKey;
            const primaryTagColor = child.tags[0]?.color ?? null;
            const isQuery = isQueryNode(child);
            const hasFields =
              resolveProps(child, nodes, { showAllFields }).length > 0;
            const isExpandable =
              child.children.length > 0 || isQuery || hasFields;

            return (
              <tr
                key={childKey}
                className="border-b border-foreground/[0.03] hover:bg-foreground/[0.02] transition-colors"
                data-node-id={child.id}
                data-instance-key={childKey}
              >
                {/* Name cell — shared NodeRow */}
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
                        node={child}
                        collapsible={isExpandable}
                        isRef={false}
                        tagColor={primaryTagColor}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey) zoomTo(child.id);
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
                        cursorPosition={cursorPosition}
                        onActivate={(pos) =>
                          activateNode(child.id, pos, childKey)
                        }
                        onChange={(text) =>
                          mutations.updateNodeContent(child.id, text)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void mutations.createNodeAfter(child.id);
                          }
                        }}
                      />
                    }
                  />
                </td>

                {/* Field cells */}
                {columns.map((col) => (
                  <td key={col.fieldId} className="px-2 py-1 align-top">
                    <TableCellField nodeId={child.id} fieldId={col.fieldId} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      {hasMore && (
        <div className="p-2 border-t border-foreground/[0.06] text-center">
          <button
            type="button"
            className="text-[11px] text-foreground/50 hover:text-foreground/80 font-medium px-3 py-1 rounded bg-foreground/[0.04] hover:bg-foreground/[0.08] cursor-pointer"
            onClick={() =>
              setVisibleLimit((prev) => prev + viewConfig.pagesize)
            }
          >
            Show more ({sortedChildren.length - visibleLimit} remaining)
          </button>
        </div>
      )}
    </div>
  );
}

function SortIndicator({
  sort,
  fieldId,
}: {
  sort: import("@/lib/view-config").SortSpec[];
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

function TableCellField({
  nodeId,
  fieldId,
}: {
  nodeId: string;
  fieldId: string;
}) {
  const node = useOutlineStore((s) => s.nodes.get(nodeId));
  const nodes = useOutlineStore((s) => s.nodes);
  const queryDb = useOutlineStore((s) => s.queryDb);
  const rev = useOutlineStore((s) => s.rev);

  if (!node) return null;

  const fieldType = resolveFieldTypeById(fieldId, nodes);
  const fieldNode = nodes.get(fieldId);
  const allowedRefIds =
    fieldType === "ref"
      ? resolveAllowedRefIdsCached(fieldId, fieldNode, nodes, queryDb, rev)
      : null;

  const values = node.props[fieldId] ?? [];

  if (values.length === 0) {
    const emptyVal = emptyValueForType(fieldType);
    return (
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
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {values.map((v, i) => (
        <PropValueEditor
          key={`${fieldId}-${i}`}
          value={v}
          display={formatPropValue(v, nodes)}
          fieldType={fieldType}
          allowedRefIds={allowedRefIds}
          nodes={nodes}
          onCommit={(next: PropValue) =>
            void mutations.updateProp(nodeId, fieldId, next, v)
          }
        />
      ))}
    </div>
  );
}
