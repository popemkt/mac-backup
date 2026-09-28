import type { NodeMap } from "@/lib/types";
import { WORKSPACE_ROOT_ID } from "@/lib/types";

/** Nest a child render under a parent instance key. */
export function childInstanceKey(parentKey: string, nodeId: string): string {
  return `${parentKey}/${nodeId}`;
}

/**
 * Canonical outline-tree instance for a node (parent-path + nodeId).
 * Used when mutations/keyboard activate without an explicit render instance.
 */
export function outlineInstanceKey(nodeId: string, nodes: NodeMap): string {
  const chain: string[] = [];
  let cur: string | null = nodeId;
  const seen = new Set<string>();
  while (cur !== null && cur !== WORKSPACE_ROOT_ID) {
    if (seen.has(cur)) break;
    seen.add(cur);
    chain.unshift(cur);
    cur = nodes.get(cur)?.parentId ?? null;
  }
  return `tree/${chain.join("/")}`;
}

/**
 * Every instance a query projects carries this prefix, and so does everything
 * nested under one (`childInstanceKey` appends to it).
 */
const PROJECTION_PREFIX = "ref:";
const QUERY_RESULT_PREFIX = `${PROJECTION_PREFIX}query:`;

/** Query-result / reference-container instance. */
export function queryResultInstanceKey(queryNodeId: string, nodeId: string): string {
  return `${QUERY_RESULT_PREFIX}${queryNodeId}/${nodeId}`;
}

/**
 * The instance sits somewhere inside a query's projected rows — a result row
 * or one of its descendants. Their visibility is decided by the query
 * component that mounts them, not by the outline walk alone.
 */
export function isInsideQueryResults(instanceKey: string): boolean {
  return instanceKey.startsWith(PROJECTION_PREFIX);
}

/**
 * The instance IS a query result: its place under the query is computed, not
 * a child edge, so there is no structural edge for Tab, Enter or a move to
 * operate on. Its descendants are ordinary child edges of the result and are
 * not results themselves.
 *
 * Read from the key because the key is the row's identity: whatever renders
 * the row, the answer cannot disagree with where the row actually is.
 */
export function isQueryResultInstance(instanceKey: string): boolean {
  if (!instanceKey.startsWith(QUERY_RESULT_PREFIX)) return false;
  // `ref:query:<queryId>/<resultId>` — one separator; a descendant adds more.
  return instanceKey.slice(QUERY_RESULT_PREFIX.length).split("/").length === 2;
}

/**
 * The node ids of the rows an instance is drawn under, outermost first — the
 * query node for a projected row, then every row on the path down to (not
 * including) the instance itself.
 */
export function instanceAncestorIds(instanceKey: string): string[] {
  const path = instanceKey.startsWith(QUERY_RESULT_PREFIX)
    ? instanceKey.slice(QUERY_RESULT_PREFIX.length)
    : instanceKey.slice(instanceKey.indexOf("/") + 1);
  return path.split("/").slice(0, -1);
}
