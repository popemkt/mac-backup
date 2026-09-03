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
import type { NodeMap, OutlineNode } from "@/lib/types";
import {
  applyViewFilters,
  flattenBoardOrder,
  getViewConfig,
  groupChildrenForBoard,
  sortChildrenForTable,
  type BoardColumn,
  type ViewMode,
} from "@/lib/view-config";

export interface FrameRowsInput {
  frameId: string;
  nodes: NodeMap;
  /** Explicit row ids (query results) — overrides structural children. */
  rowIds?: string[];
  /** Pages revealed in a paginating mode (1 = first page). Default 1. */
  pages?: number;
}

export interface FrameRows {
  mode: ViewMode;
  /** Filtered + sorted rows before pagination; board order is column-major. */
  ordered: OutlineNode[];
  /** Board/cards grouping over the same ordered rows; empty otherwise. */
  columns: BoardColumn[];
  /** Field the rows are grouped by (board only; null for every other mode). */
  groupFieldId: string | null;
  /** Rows actually rendered — pagination applied for paginating modes. */
  rendered: OutlineNode[];
  hasMore: boolean;
  pagesize: number;
}

/**
 * Modes that reveal rows incrementally. The distinction lives here rather than
 * as a slice at one call site, so nav and render agree by construction and
 * extending pagination to another mode is a one-line change.
 */
export function modePaginates(mode: ViewMode): boolean {
  return mode === "table";
}

function nodesByIds(ids: readonly string[], nodes: NodeMap): OutlineNode[] {
  return ids.map((id) => nodes.get(id)).filter((n): n is OutlineNode => n !== undefined);
}

/** List-mode structural children, view filters applied. */
export function frameListChildren(frameId: string, nodes: NodeMap): OutlineNode[] {
  const frame = nodes.get(frameId);
  if (!frame) return [];
  const config = getViewConfig(frame.props);
  return applyViewFilters(nodesByIds(frame.children, nodes), config.filters, nodes);
}

export function frameRows({ frameId, nodes, rowIds, pages }: FrameRowsInput): FrameRows {
  const frame = nodes.get(frameId);
  const config = getViewConfig(frame?.props);
  const empty: FrameRows = {
    mode: config.mode,
    ordered: [],
    columns: [],
    groupFieldId: null,
    rendered: [],
    hasMore: false,
    pagesize: config.pagesize,
  };
  if (!frame && !rowIds) return empty;

  const source = nodesByIds(rowIds ?? frame?.children ?? [], nodes);
  const filtered = applyViewFilters(source, config.filters, nodes);
  const sorted = sortChildrenForTable(filtered, config.sort, nodes);

  const grouped = config.mode === "board" || config.mode === "cards";
  // Only board groups by a field; cards is a single unlabelled column.
  const groupFieldId = config.mode === "board" ? config.groupFieldId : null;
  const columns = grouped ? groupChildrenForBoard(sorted, groupFieldId, nodes) : [];
  const ordered = grouped ? flattenBoardOrder(columns) : sorted;

  // Pages, not an absolute row count: a pagesize change re-derives the limit
  // instead of leaving a stale reveal count behind.
  const limit = config.pagesize * Math.max(1, pages ?? 1);
  const paginates = modePaginates(config.mode);
  const rendered = paginates ? ordered.slice(0, limit) : ordered;

  return {
    mode: config.mode,
    ordered,
    columns,
    groupFieldId,
    rendered,
    hasMore: paginates && ordered.length > limit,
    pagesize: config.pagesize,
  };
}

/** Rows a projected frame renders, in render order. */
export function frameRenderedRows(input: FrameRowsInput): OutlineNode[] {
  return frameRows(input).rendered;
}
