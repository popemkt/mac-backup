/**
 * Query nodes (DESIGN-REFINE §2 W4): pure system-node modeling. A query
 * node is an ordinary node tagged #query (sys.tag.query) carrying its EDN
 * definition in sys.f.query (+ optional sys.f.query.limit cap). Expanded
 * query nodes subscribe over /ws; results render as read-only ref rows.
 */
import type { KbWsClient } from "@/api/ws";
import { SYSTEM_IDS, type NodeMap, type OutlineNode, type TagBadge } from "@/lib/types";

export interface QueryNodeDef {
  edn: string;
  limit: number | null;
}

/** Matches bullet-mode semantics: the sys query tag or any tag named "query". */
export function isQueryTagBadges(tags: TagBadge[]): boolean {
  return tags.some((t) => t.id === SYSTEM_IDS.queryTag || t.name.toLowerCase() === "query");
}

export function isQueryNode(node: OutlineNode | undefined): boolean {
  return node !== undefined && isQueryTagBadges(node.tags);
}

/** EDN + limit off the node's props; null when not a query node / no EDN. */
export function queryDefOf(node: OutlineNode | undefined): QueryNodeDef | null {
  if (!node || !isQueryTagBadges(node.tags)) return null;
  const ednVal = (node.props[SYSTEM_IDS.queryField] ?? []).find(
    (v) => v.t === "str" && typeof v.v === "string" && v.v.trim() !== "",
  );
  if (!ednVal) return null;
  const limitVal = (node.props[SYSTEM_IDS.queryLimitField] ?? []).find(
    (v) => v.t === "num" && typeof v.v === "number",
  );
  return {
    edn: String(ednVal.v).trim(),
    limit: limitVal ? Number(limitVal.v) : null,
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
    if (!id || seen.has(id) || id === opts.excludeId) continue;
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
