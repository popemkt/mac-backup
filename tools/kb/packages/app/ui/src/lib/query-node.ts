/**
 * Query nodes in the UI: their result ids and their /ws subscription. What a
 * query node is (its field, its EDN and limit) is `@kb/model`'s
 * `query-node.ts`, read the same way by the server.
 */
import type { KbWsClient, SubscriptionSink } from "@/api/ws";
import type { NodeMap } from "@/lib/types";

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

/**
 * One subscriber's subscription to a query node. A subscription id names one
 * sink on the socket, so two subscribers to one query node (its row in two
 * panes, a chart beside its row) each hold their own, and one letting go
 * never ends the other's.
 */
export function querySubscriptionId(nodeId: string, subscriber: string): string {
  return `query-node:${nodeId}#${subscriber}`;
}

/**
 * Live-subscribe a query node over the existing /ws SubscriptionHub, as
 * `subscriber`. Returns the unsubscribe thunk (call on collapse/unmount).
 */
export function subscribeQueryNode(
  client: KbWsClient,
  nodeId: string,
  subscriber: string,
  edn: string,
  sink: SubscriptionSink,
): () => void {
  const id = querySubscriptionId(nodeId, subscriber);
  client.subscribe(id, edn, sink);
  return () => client.unsubscribe(id);
}

/** Default definition for palette-minted query nodes. */
export const DEFAULT_QUERY_EDN = "[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]";
