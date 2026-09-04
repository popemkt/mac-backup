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

/** Query-result / reference-container instance. */
export function queryResultInstanceKey(queryNodeId: string, nodeId: string): string {
  return `ref:query:${queryNodeId}/${nodeId}`;
}
