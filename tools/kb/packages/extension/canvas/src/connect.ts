/**
 * Drawing an edge between two items: what the pointer's edge drag makes and
 * what an agent's `connect` asks for, one record either way. An edge is a
 * drawing (INSPIRATIONS: the Logseq decision); it records the nodes its
 * ends stand for (`kbLink`), and binds a ref prop between them only when
 * asked, once (`bind`, written beside the document by its caller).
 */
import { upsertCanvasEdge, type CanvasDoc, type CanvasEdge, type CanvasSide } from "./doc.ts";
import { CanvasRelationError, facingSides } from "./relations.ts";

export interface CanvasConnection {
  /** The new edge's id, and the id of its binding. */
  readonly id: string;
  readonly bindingId: string;
  readonly from: string;
  readonly to: string;
  /** The sides it leaves and arrives by; absent, the ones facing each other (`facingSides`). */
  readonly fromSide?: CanvasSide;
  readonly toSide?: CanvasSide;
  readonly label?: string;
  /** The ref field the edge binds from `from`'s node to `to`'s, once; both ends need a node. */
  readonly bindField?: string;
}

/**
 * `doc` with an arrow drawn from item `from` to item `to`, and the edge.
 * Throws `CanvasRelationError` when an end is not on the canvas, the two
 * are one item, or a bind is asked of an end that stands for no node.
 */
export function connectItems(
  doc: CanvasDoc,
  connection: CanvasConnection,
): { readonly doc: CanvasDoc; readonly edge: CanvasEdge } {
  const { id, bindingId, from: fromId, to: toId, label, bindField } = connection;
  const from = doc.nodes.find((node) => node.id === fromId);
  const to = doc.nodes.find((node) => node.id === toId);
  if (from === undefined) throw new CanvasRelationError(`no item ${fromId} on this canvas`);
  if (to === undefined) throw new CanvasRelationError(`no item ${toId} on this canvas`);
  if (fromId === toId)
    throw new CanvasRelationError(`an edge joins two items, not ${fromId} to itself`);
  if (bindField !== undefined && (from.nodeId === undefined || to.nodeId === undefined)) {
    throw new CanvasRelationError(`a bound edge joins two items that stand for nodes`);
  }
  const facing = facingSides(from, to);
  const edge: CanvasEdge = {
    id,
    fromNode: fromId,
    toNode: toId,
    fromSide: connection.fromSide ?? facing.fromSide,
    toSide: connection.toSide ?? facing.toSide,
    toEnd: "arrow",
    ...(label === undefined ? {} : { label }),
    kbLink: {
      mode: bindField === undefined ? "layout" : "native",
      via: "prop",
      fieldId: bindField ?? "",
      sourceNodeId: from.nodeId ?? "",
      targetNodeId: to.nodeId ?? "",
      bindingId,
    },
  };
  return { doc: upsertCanvasEdge(doc, edge), edge };
}
