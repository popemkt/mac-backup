/**
 * Render-order visible outline instances (tree + query-result rows).
 *
 * Row order is not decided here — every frame's rows come from
 * {@link frameRows} / {@link frameListChildren}, the same functions the
 * renderers call. This walk only assigns instance keys and recurses.
 */
import type { QueryDb } from "@/ds/db";
import { runQuery } from "@/ds/query";
import { childInstanceKey, outlineInstanceKey, queryResultInstanceKey } from "@/lib/instance-key";
import { frameListChildren, frameRows } from "@/lib/frame-rows";
import { isQueryNode, queryDefOf, resultNodeIds } from "@/lib/query-node";
import type { NodeMap } from "@/lib/types";
import { getViewConfig, isProjectedViewMode } from "@/lib/view-config";
import { hasText } from "@/lib/text";

export type VisibleInstance = {
  nodeId: string;
  instanceKey: string;
};

/** Pages revealed per frame in paginating modes, keyed by frame node id. */
export type FramePagesMap = Readonly<Record<string, number>>;

/** What a walk carries all the way down: the graph, the query db, the
 * per-frame page counts, and the list it appends to. */
interface WalkContext {
  nodes: NodeMap;
  queryDb: QueryDb | null;
  pages: FramePagesMap;
  out: VisibleInstance[];
}

function emitProjectedRows(
  ctx: WalkContext,
  frameId: string,
  rowIds: string[] | undefined,
  keyFor: (nodeId: string) => string,
): void {
  const { nodes, pages, out } = ctx;
  const { rendered } = frameRows({
    frameId,
    nodes,
    rowIds,
    pages: pages[frameId],
  });
  for (const child of rendered) {
    out.push({ nodeId: child.id, instanceKey: keyFor(child.id) });
  }
}

function walkVisibleInstances(
  ctx: WalkContext,
  nodeId: string,
  instanceKey: string,
  isRef: boolean,
): void {
  const { nodes, queryDb, out } = ctx;
  const node = nodes.get(nodeId);
  if (!node) return;
  out.push({ nodeId, instanceKey });
  if (node.collapsed) return;

  const viewConfig = getViewConfig(node.props);
  const projected = isProjectedViewMode(viewConfig.mode);

  // Query results — list walks refs; projected modes emit flat result rows.
  if (!isRef && isQueryNode(node)) {
    const def = queryDefOf(node);
    if (hasText(def?.edn) && queryDb) {
      try {
        const rows = runQuery(queryDb, def.edn);
        const ids = resultNodeIds(rows, nodes, {
          limit: def.limit,
          excludeId: nodeId,
        });

        if (projected) {
          emitProjectedRows(ctx, nodeId, ids, (id) => queryResultInstanceKey(nodeId, id));
          return;
        }

        for (const id of ids) {
          walkVisibleInstances(ctx, id, queryResultInstanceKey(nodeId, id), true);
        }
      } catch {
        // Broken EDN: skip results
      }
    }
    // Non-projected query: also walk structural children below results.
  }

  if (projected) {
    if (isQueryNode(node)) return;
    emitProjectedRows(ctx, nodeId, undefined, (id) => childInstanceKey(instanceKey, id));
    return;
  }

  for (const child of frameListChildren(nodeId, nodes)) {
    walkVisibleInstances(ctx, child.id, childInstanceKey(instanceKey, child.id), false);
  }
}

export function collectVisibleInstances(
  rootNodeId: string,
  nodes: NodeMap,
  queryDb: QueryDb | null,
  pages: FramePagesMap = {},
): VisibleInstance[] {
  const out: VisibleInstance[] = [];
  const root = nodes.get(rootNodeId);
  if (!root) return out;
  const ctx: WalkContext = { nodes, queryDb, pages, out };

  if (isProjectedViewMode(getViewConfig(root.props).mode)) {
    emitProjectedRows(ctx, rootNodeId, undefined, (id) => outlineInstanceKey(id, nodes));
    return out;
  }

  for (const child of frameListChildren(rootNodeId, nodes)) {
    walkVisibleInstances(ctx, child.id, outlineInstanceKey(child.id, nodes), false);
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
