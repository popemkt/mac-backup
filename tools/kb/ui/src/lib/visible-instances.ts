/**
 * Render-order visible outline instances (tree + query-result rows).
 * Must stay aligned with NodeBlock / QueryResultsSection / OutlineEditor /
 * TableView / BoardCardsView.
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
import type { NodeMap, OutlineNode } from "@/lib/types";
import {
  applyViewFilters,
  flattenBoardOrder,
  getViewConfig,
  groupChildrenForBoard,
  isProjectedViewMode,
  sortChildrenForTable,
} from "@/lib/view-config";

export type VisibleInstance = {
  nodeId: string;
  instanceKey: string;
};

function childNodes(parent: OutlineNode, nodes: NodeMap): OutlineNode[] {
  return parent.children
    .map((id) => nodes.get(id))
    .filter((n): n is OutlineNode => n !== undefined);
}

function projectFrameRows(
  parent: OutlineNode,
  nodes: NodeMap,
  rowNodes: OutlineNode[],
): OutlineNode[] {
  const viewConfig = getViewConfig(parent.props);
  const filtered = applyViewFilters(rowNodes, viewConfig.filters, nodes);
  const sorted = sortChildrenForTable(filtered, viewConfig.sort, nodes);
  if (viewConfig.mode === "board") {
    return flattenBoardOrder(
      groupChildrenForBoard(sorted, viewConfig.groupFieldId, nodes),
    );
  }
  // table + cards: sorted flat order
  return sorted;
}

function emitProjectedRows(
  parentKey: string,
  parent: OutlineNode,
  nodes: NodeMap,
  rowNodes: OutlineNode[],
  out: VisibleInstance[],
  keyFor: (nodeId: string) => string,
): void {
  for (const child of projectFrameRows(parent, nodes, rowNodes)) {
    out.push({
      nodeId: child.id,
      instanceKey: keyFor(child.id),
    });
  }
}

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

  const viewConfig = getViewConfig(node.props);

  // Query results — list walks refs; projected modes emit flat result rows.
  if (!isRef && isQueryNode(node)) {
    const def = queryDefOf(node);
    if (def?.edn && queryDb) {
      try {
        const rows = runQuery(queryDb, def.edn);
        const ids = resultNodeIds(rows, nodes, {
          limit: def.limit,
          excludeId: nodeId,
        });
        const resultNodes = ids
          .map((id) => nodes.get(id))
          .filter((n): n is OutlineNode => n !== undefined);

        if (isProjectedViewMode(viewConfig.mode)) {
          emitProjectedRows(
            instanceKey,
            node,
            nodes,
            resultNodes,
            out,
            (id) => queryResultInstanceKey(nodeId, id),
          );
          return;
        }

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
        // Broken EDN: skip results
      }
    }
    // Non-projected query: also walk structural children below results.
  }

  if (isProjectedViewMode(viewConfig.mode) && !isQueryNode(node)) {
    emitProjectedRows(
      instanceKey,
      node,
      nodes,
      childNodes(node, nodes),
      out,
      (id) => childInstanceKey(instanceKey, id),
    );
    return;
  }

  if (isProjectedViewMode(viewConfig.mode) && isQueryNode(node)) {
    return;
  }

  // List mode — filtered structural children.
  const kids = applyViewFilters(
    childNodes(node, nodes),
    viewConfig.filters,
    nodes,
  );
  for (const child of kids) {
    walkVisibleInstances(
      child.id,
      childInstanceKey(instanceKey, child.id),
      false,
      nodes,
      queryDb,
      out,
    );
  }
}

export function collectVisibleInstances(
  rootNodeId: string,
  nodes: NodeMap,
  queryDb: QueryDb | null,
): VisibleInstance[] {
  const out: VisibleInstance[] = [];
  const root = nodes.get(rootNodeId);
  if (!root) return out;

  const rootConfig = getViewConfig(root.props);
  if (isProjectedViewMode(rootConfig.mode)) {
    emitProjectedRows(
      `tree/${rootNodeId}`,
      root,
      nodes,
      childNodes(root, nodes),
      out,
      (id) => outlineInstanceKey(id, nodes),
    );
    return out;
  }

  const kids = applyViewFilters(
    childNodes(root, nodes),
    rootConfig.filters,
    nodes,
  );
  for (const child of kids) {
    const key = outlineInstanceKey(child.id, nodes);
    walkVisibleInstances(child.id, key, false, nodes, queryDb, out);
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
