/**
 * Single owner of "which rows does this frame show, in what order".
 *
 * A frame is any node acting as a container: an outline parent, a projected
 * table/board/cards frame, or a query node presenting its results. Every
 * consumer resolves rows here — NodeBlock (list children), TableView,
 * BoardCardsView, and the visible-instance walk that drives keyboard
 * navigation — so rendered order and navigable order cannot drift.
 *
 * Pure: pagination state is passed in as `pages`, never read from a store.
 */
import type { SchemaIndex } from "@/lib/schema";
import type { NodeMap, OutlineNode } from "@/lib/types";
import {
  applyViewFilters,
  flattenBoardOrder,
  groupChildrenForBoard,
  sortChildrenForTable,
  type BoardColumn,
  type FrameView,
} from "@/lib/view-config";

export interface FrameRowsInput {
  frameId: string;
  /** The projection the rows come from. */
  nodes: NodeMap;
  /** What their fields mean: labels to filter, sort and group by. */
  schema: SchemaIndex;
  /** The view the frame shows its rows in, and the settings it reads (`frameViewOf`). */
  view: FrameView;
  /** Explicit row ids (query results) — overrides structural children. */
  rowIds?: readonly string[];
  /** Pages revealed in a paginating view (1 = first page). Default 1. */
  pages?: number;
}

export interface FrameRows {
  /** Filtered + sorted rows before pagination; board order is column-major. */
  ordered: OutlineNode[];
  /** Column grouping over the same ordered rows; empty for a view without columns. */
  columns: BoardColumn[];
  /** Field the columns are grouped by (null when the view declares none, or none is set). */
  groupFieldId: string | null;
  /** Rows actually rendered — pagination applied for a paginating view. */
  rendered: OutlineNode[];
  hasMore: boolean;
}

function nodesByIds(ids: readonly string[], nodes: NodeMap): OutlineNode[] {
  return ids.map((id) => nodes.get(id)).filter((n): n is OutlineNode => n !== undefined);
}

/**
 * A frame's rows, as its view lays them out. What happens to them follows from
 * the settings the view's params declare, so nav and render agree by
 * construction: every view filters; a view sorts when it declares `sort`,
 * groups its columns by a field when it declares `groupFieldId`, and pages when
 * it declares `pagesize`.
 */
export function frameRows({
  frameId,
  nodes,
  schema,
  view,
  rowIds,
  pages,
}: FrameRowsInput): FrameRows {
  const frame = nodes.get(frameId);
  const empty: FrameRows = {
    ordered: [],
    columns: [],
    groupFieldId: null,
    rendered: [],
    hasMore: false,
  };
  if (!frame && !rowIds) return empty;

  const { key, params } = view;
  const source = nodesByIds(rowIds ?? frame?.children ?? [], nodes);
  const filtered = applyViewFilters(source, params.filters, schema);
  const sorted = sortChildrenForTable(filtered, params.sort ?? [], schema);

  const grouped = key.rows === "columns";
  const groupFieldId = params.groupFieldId ?? null;
  const columns = grouped ? groupChildrenForBoard(sorted, groupFieldId, schema) : [];
  const ordered = grouped ? flattenBoardOrder(columns) : sorted;

  // Pages, not an absolute row count: a pagesize change re-derives the limit
  // instead of leaving a stale reveal count behind.
  const limit = params.pagesize === undefined ? null : params.pagesize * Math.max(1, pages ?? 1);
  const rendered = limit === null ? ordered : ordered.slice(0, limit);

  return {
    ordered,
    columns,
    groupFieldId,
    rendered,
    hasMore: limit !== null && ordered.length > limit,
  };
}

/** Rows a frame renders, in render order. */
export function frameRenderedRows(input: FrameRowsInput): OutlineNode[] {
  return frameRows(input).rendered;
}
