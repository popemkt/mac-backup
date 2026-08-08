/**
 * Render-order visible outline instances (tree + query-result rows).
 * Must stay aligned with NodeBlock / QueryResultsSection / OutlineEditor.
 */
import type { QueryDb } from "@/ds/db";
import { runQuery } from "@/ds/query";
import {
  childInstanceKey,
  outlineInstanceKey,
  queryResultInstanceKey,
} from "@/lib/instance-key";
import {
  isQueryNode,
  queryDefOf,
  resultNodeIds,
} from "@/lib/query-node";
import { WORKSPACE_ROOT_ID, type NodeMap } from "@/lib/types";

export type VisibleInstance = {
  nodeId: string;
  instanceKey: string;
};

function walkVisibleInstances(
  nodeId: string,
  instanceKey: string,
  isRef: boolean,
  nodes: NodeMap,
  queryDb: QueryDb | null,
  out: VisibleInstance[],
): void {
  const node = nodes.get(nodeId);
  if (!node) return;
  out.push({ nodeId, instanceKey });
  if (node.collapsed) return;

  // Query results render before structural children (NodeBlock order).
  if (!isRef && isQueryNode(node)) {
    const def = queryDefOf(node);
    if (def?.edn && queryDb) {
      try {
        const rows = runQuery(queryDb, def.edn);
        const ids = resultNodeIds(rows, nodes, {
          limit: def.limit,
          excludeId: nodeId,
        });
        for (const id of ids) {
          walkVisibleInstances(
            id,
            queryResultInstanceKey(nodeId, id),
            true,
            nodes,
            queryDb,
            out,
          );
        }
      } catch {
        // Broken EDN: skip results (UI shows the error separately).
      }
    }
  }

  // Children of ref rows are ordinary (isRef does not cascade).
  for (const childId of node.children) {
    walkVisibleInstances(
      childId,
      childInstanceKey(instanceKey, childId),
      false,
      nodes,
      queryDb,
      out,
    );
  }
}

/**
 * Visible render instances for the current zoom/home root, in DOM order.
 * Zoomed root header is not a NodeBlock — only its children are listed.
 */
export function collectVisibleInstances(
  rootNodeId: string,
  nodes: NodeMap,
  queryDb: QueryDb | null,
): VisibleInstance[] {
  const out: VisibleInstance[] = [];
  const root = nodes.get(rootNodeId);
  if (!root) return out;

  for (const childId of root.children) {
    // Full ancestor chain — matches outlineInstanceKey / zoomed OutlineEditor.
    const key = outlineInstanceKey(childId, nodes);
    walkVisibleInstances(childId, key, false, nodes, queryDb, out);
  }
  return out;
}

export function neighborVisibleInstance(
  instances: VisibleInstance[],
  instanceKey: string,
  dir: -1 | 1,
): VisibleInstance | null {
  const idx = instances.findIndex((i) => i.instanceKey === instanceKey);
  if (idx < 0) return null;
  return instances[idx + dir] ?? null;
}
