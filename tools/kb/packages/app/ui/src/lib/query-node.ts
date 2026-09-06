/**
 * Query nodes (DESIGN-REFINE §2 W4): pure system-node modeling. A query node
 * is an ordinary node carrying its EDN definition in `sys.f.query` (+ optional
 * `sys.f.query.limit` cap). Expanded query nodes subscribe over /ws; results
 * render as read-only ref rows.
 *
 * **The field is the kind** (DESIGN.md → Kinds, roles and options). A `#query`
 * supertag used to mark these rows as well, which meant one distinction had two
 * carriers and the reader picked the wrong one: it matched any tag whose *name*
 * was "query", so a user tag called `query` turned its rows into live
 * subscriptions, and it read `node.tags` — a display array that drops kind refs
 * — as though it were membership. Strip the field and a query node is a plain
 * node, so the field is what a query node is.
 */
import type { KbWsClient } from "@/api/ws";
import { SYSTEM_IDS, type NodeMap, type OutlineNode, type PropValue } from "@/lib/types";

export interface QueryNodeDef {
  edn: string;
  limit: number | null;
}

/**
 * Props-shaped so the wire node and the outline node ask the same question —
 * `graph-view`'s default-collapse rule runs before outline nodes exist.
 */
export function hasQueryDef(props: Record<string, PropValue[]> | undefined): boolean {
  return props?.[SYSTEM_IDS.queryField] !== undefined;
}

export function isQueryNode(node: Pick<OutlineNode, "props"> | undefined): boolean {
  return hasQueryDef(node?.props);
}

/** EDN + limit off the node's props; null when not a query node / no EDN. */
export function queryDefOf(node: OutlineNode | undefined): QueryNodeDef | null {
  if (!node) return null;
  const ednVal = (node.props[SYSTEM_IDS.queryField] ?? []).find(
    (v) => v.t === "str" && typeof v.v === "string" && v.v.trim() !== "",
  );
  if (!ednVal) return null;
  const limitVal = (node.props[SYSTEM_IDS.queryLimitField] ?? []).find(
    (v) => v.t === "num" && typeof v.v === "number",
  );
  return {
    edn: String(ednVal.v).trim(),
    limit: limitVal ? limitVal.v : null,
  };
}

/**
 * Map raw datalog rows to result node ids: first column value per row that
 * names a known node. Dedupes, drops the query node itself, applies limit.
 */
export function resultNodeIds(
  rows: unknown[][],
  nodes: NodeMap,
  opts: { limit?: number | null; excludeId?: string } = {},
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const limit = opts.limit ?? null;
  for (const row of rows) {
    const id = row.find((v): v is string => typeof v === "string" && nodes.has(v));
    if (id === undefined || seen.has(id) || id === opts.excludeId) continue;
    seen.add(id);
    out.push(id);
    if (limit !== null && out.length >= limit) break;
  }
  return out;
}

export function querySubscriptionId(nodeId: string): string {
  return `query-node:${nodeId}`;
}

/**
 * Live-subscribe a query node over the existing /ws SubscriptionHub.
 * Returns the unsubscribe thunk (call on collapse/unmount).
 */
export function subscribeQueryNode(
  client: KbWsClient,
  nodeId: string,
  edn: string,
  onRows: (rows: unknown[][], rev: number) => void,
): () => void {
  const id = querySubscriptionId(nodeId);
  client.subscribe(id, edn, onRows);
  return () => client.unsubscribe(id);
}

/** Default definition for palette-minted query nodes. */
export const DEFAULT_QUERY_EDN = "[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]";
