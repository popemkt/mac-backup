/**
 * Render-order visible outline instances (tree + query-result rows).
 *
 * Row order is not decided here — every frame's rows come from
 * {@link frameRows}, the function the renderers call, as each frame's view
 * ({@link frameViewOf}) lays them out. This walk only assigns instance keys and recurses.
 */
import type { SchemaIndex } from "@/lib/schema";
import type { KbIndex } from "@/ds";
import { runQuery } from "@/ds";
import {
  childInstanceKey,
  isQueryResultInstance,
  MAIN_OUTLINE_HOST,
  outlineInstanceKey,
  queryResultInstanceKey,
} from "@/lib/instance-key";
import { frameRows } from "@/lib/frame-rows";
import { isQueryNode, queryDefOf, resultNodeIds } from "@/lib/query-node";
import type { NodeMap } from "@/lib/types";
import { frameViewOf, type FrameView } from "@/lib/view-config";
import { projectsRows, type FrameViewKey } from "@kb/views";
import { hasText } from "@/lib/text";
import { slotLink, slotRenders, type SlotChain } from "@/lib/view-key";
import { shownNode, showsAncestor } from "@/lib/contextual-ref";

export type VisibleInstance = {
  nodeId: string;
  instanceKey: string;
};

/** Pages revealed per frame in paginating modes, keyed by frame node id. */
type FramePagesMap = Readonly<Record<string, number>>;

/** What a walk carries all the way down: the graph, the query db, the
 * per-frame page counts, and the list it appends to. */
interface WalkContext {
  nodes: NodeMap;
  schema: SchemaIndex;
  queryDb: KbIndex | null;
  /** The frame views provided, which a frame's props resolve against. */
  views: readonly FrameViewKey[];
  /** The slots around the outline's root frame, as its host renders it (`useSlotChain`). */
  chain: SlotChain;
  pages: FramePagesMap;
  out: VisibleInstance[];
}

function emitProjectedRows(
  ctx: WalkContext,
  frameId: string,
  view: FrameView,
  rowIds: string[] | undefined,
  keyFor: (nodeId: string) => string,
): void {
  const { nodes, schema, pages, out } = ctx;
  const { rendered } = frameRows({
    frameId,
    nodes,
    schema,
    view,
    rowIds,
    pages: pages[frameId],
  });
  for (const child of rendered) {
    out.push({ nodeId: child.id, instanceKey: keyFor(child.id) });
  }
}

/**
 * The chain under a frame's slot, or null when the slot would not render it —
 * the one rule the slot itself applies (`slotRenders`), so a frame whose rows
 * the outline refused to draw offers none to the keyboard either.
 */
function underSlot(chain: SlotChain, view: FrameView, frameId: string): SlotChain | null {
  const link = slotLink(view.key, frameId);
  return slotRenders(chain, link) ? [...chain, link] : null;
}

function walkVisibleInstances(
  ctx: WalkContext,
  nodeId: string,
  instanceKey: string,
  chain: SlotChain,
): void {
  const { nodes, schema, queryDb, out } = ctx;
  const node = nodes.get(nodeId);
  if (!node) return;
  out.push({ nodeId, instanceKey });
  // Open or closed is the row's own; what is under it is its shown node's
  // (`lib/contextual-ref`), unless that node is already shown above it.
  if (node.collapsed || showsAncestor(instanceKey, node, schema)) return;
  const frame = shownNode(node, schema);
  const frameId = frame.id;

  // A frame whose view is not provided shows no rows, so it offers none.
  const view = frameViewOf(frame, schema, ctx.views);
  if (view === null) return;
  const projected = projectsRows(view.key);

  // Query results — list walks refs; projected modes emit flat result rows. A
  // result row does not re-run its own query (`resolveRowChrome` agrees).
  if (!isQueryResultInstance(instanceKey) && isQueryNode(frame)) {
    const def = queryDefOf(frame);
    if (hasText(def?.edn) && queryDb) {
      try {
        const rows = runQuery(queryDb, def.edn);
        const ids = resultNodeIds(rows, nodes, {
          limit: def.limit,
          excludeId: frameId,
        });

        // Projected results sit in the query frame's slot; the list draws
        // them itself, as rows of its own.
        if (projected) {
          if (underSlot(chain, view, frameId) !== null)
            emitProjectedRows(ctx, frameId, view, ids, (id) => queryResultInstanceKey(frameId, id));
          return;
        }

        for (const id of ids) {
          walkVisibleInstances(ctx, id, queryResultInstanceKey(frameId, id), chain);
        }
      } catch {
        // Broken EDN: skip results
      }
    }
    // Non-projected query: also walk structural children below results.
  }

  if (projected && isQueryNode(frame)) return;
  // A frame's children sit in its slot.
  const inner = underSlot(chain, view, frameId);
  if (inner === null) return;
  if (projected) {
    emitProjectedRows(ctx, frameId, view, undefined, (id) => childInstanceKey(instanceKey, id));
    return;
  }

  for (const child of frameRows({ frameId, nodes, schema, view }).rendered) {
    walkVisibleInstances(ctx, child.id, childInstanceKey(instanceKey, child.id), inner);
  }
}

/**
 * What the walk reads: the graph, the query db, the frame views provided, the
 * slots around the outline's root and the pages revealed.
 */
type WalkSource = Omit<WalkContext, "out">;

/**
 * The rows the outline host `host` draws under `rootNodeId`, in render order,
 * each under its instance key in that host.
 */
export function collectVisibleInstances(
  rootNodeId: string,
  source: WalkSource,
  host: string = MAIN_OUTLINE_HOST,
): VisibleInstance[] {
  const out: VisibleInstance[] = [];
  const { nodes, schema, views } = source;
  const root = nodes.get(rootNodeId);
  if (!root) return out;
  const ctx: WalkContext = { ...source, out };

  // The root's rows sit in the root frame's slot, inside the outline's.
  const view = frameViewOf(root, schema, views);
  if (view === null) return out;
  const inner = underSlot(source.chain, view, rootNodeId);
  if (inner === null) return out;
  if (projectsRows(view.key)) {
    emitProjectedRows(ctx, rootNodeId, view, undefined, (id) =>
      outlineInstanceKey(id, nodes, host),
    );
    return out;
  }

  for (const child of frameRows({ frameId: rootNodeId, nodes, schema, view }).rendered) {
    walkVisibleInstances(ctx, child.id, outlineInstanceKey(child.id, nodes, host), inner);
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
