/**
 * Drawing an edge between two items: what the pointer's edge drag makes and
 * what an agent's `connect` asks for, one record either way. An edge is a
 * drawing (INSPIRATIONS: the Logseq decision); it records the nodes its
 * ends stand for (`kbLink`), and binds a ref prop between them only when
 * asked, once (`bind`, written beside the document by its caller).
 */
import {
  upsertCanvasEdge,
  type CanvasAnchor,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasHead,
  type CanvasRoute,
  type CanvasSide,
} from "./doc.ts";
import { withEnd, withHead, withRoute, type EdgeEnd } from "./edges.ts";
import { CanvasRelationError, facingSides } from "./relations.ts";
import { canvasColor, withStyle, type CanvasLooksPatch } from "./style.ts";

export interface CanvasConnection {
  /** The new edge's id, and the id of its binding. */
  readonly id: string;
  readonly bindingId: string;
  readonly from: string;
  readonly to: string;
  /**
   * Where each end meets its item: a precise anchor, or a side's middle; an
   * end given neither meets the side facing the other item (`facingSides`).
   */
  readonly fromAnchor?: CanvasAnchor;
  readonly toAnchor?: CanvasAnchor;
  readonly fromSide?: CanvasSide;
  readonly toSide?: CanvasSide;
  /** The head each end wears, null for none; absent, none leaving and an arrow arriving. */
  readonly fromHead?: CanvasHead | null;
  readonly toHead?: CanvasHead | null;
  readonly route?: CanvasRoute;
  readonly bend?: number;
  readonly label?: string;
  /** Its colour: a palette name or id, or a literal (`canvasColor`). */
  readonly color?: string;
  readonly style?: CanvasLooksPatch;
  /** The ref field the edge binds from `from`'s node to `to`'s, once; both ends need a node. */
  readonly bindField?: string;
}

/** `edge` with its `end` placed and headed as `connection` asks, meeting `facing` when it names no place. */
function endAt(
  edge: CanvasEdge,
  connection: CanvasConnection,
  end: EdgeEnd,
  facing: CanvasSide,
): CanvasEdge {
  const anchor = end === "from" ? connection.fromAnchor : connection.toAnchor;
  const side = (end === "from" ? connection.fromSide : connection.toSide) ?? facing;
  const head = end === "from" ? connection.fromHead : connection.toHead;
  const placed = withEnd(edge, end, anchor === undefined ? { side } : { anchor });
  return head === undefined ? placed : withHead(placed, end, head);
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
  const { id, bindingId, from: fromId, to: toId, label, bindField, route, bend } = connection;
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
  const drawn: CanvasEdge = {
    id,
    fromNode: fromId,
    toNode: toId,
    toEnd: "arrow",
    ...(label === undefined ? {} : { label }),
    ...(connection.color === undefined ? {} : { color: canvasColor(connection.color) }),
    kbLink: {
      mode: bindField === undefined ? "layout" : "native",
      via: "prop",
      fieldId: bindField ?? "",
      sourceNodeId: from.nodeId ?? "",
      targetNodeId: to.nodeId ?? "",
      bindingId,
    },
  };
  const ended = endAt(
    endAt(withRoute(drawn, { route, bend }), connection, "from", facing.fromSide),
    connection,
    "to",
    facing.toSide,
  );
  const edge = connection.style === undefined ? ended : withStyle(ended, connection.style);
  return { doc: upsertCanvasEdge(doc, edge), edge };
}
