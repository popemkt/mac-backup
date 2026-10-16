/**
 * Query nodes in the UI: their /ws subscription, and the definition a new
 * one starts with. What a query node is (its field, its EDN and limit) is
 * `@kb/model`'s `query-node.ts`, read the same way by the server; the ids its
 * rows name are the kit's (`resultNodeIds`).
 */
import { getLiveClient } from "@/api/live";
import type { KbWsClient, SubscriptionSink } from "@/api/ws";
import type { QueryRowsSubscribe } from "@kb/ui-sdk";

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

/** {@link subscribeQueryNode} over the page's live socket. */
export const subscribeLiveQueryNode: QueryRowsSubscribe = (nodeId, subscriber, edn, sink) =>
  subscribeQueryNode(getLiveClient(), nodeId, subscriber, edn, sink);

/** Default definition for palette-minted query nodes. */
export const DEFAULT_QUERY_EDN = "[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]";
