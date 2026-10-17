/**
 * Comments on a canvas (DESIGN.md → Canvas documents → Comments): nodes
 * like any other, tagged `#comment`. A thread is a comment on a canvas
 * (`sys.f.comment.canvas`, a ref, so the comment is the canvas's backlink)
 * and its replies are its children, comments too, in order. Where it is
 * pinned is exactly one of: a node the canvas shows (`sys.f.comment.node`,
 * a ref, so it is that node's backlink too, pinned on every card that shows
 * it), an item that is no card (`sys.f.comment.item`, by id), or a point on
 * the canvas (`sys.f.comment.at`). Its text is what it says; whether the
 * thread is resolved is an option field (`sys.f.comment.state`).
 */
import {
  firstStr,
  refValuesOf,
  typeRefsOf,
  type KbNode,
  type NodeId,
  type PropValue,
} from "@kb/model";
import type { CanvasDoc, CanvasNode } from "./doc.ts";
import { CANVAS_IDS } from "./ids.ts";

/** Where a thread is pinned on its canvas. */
export type CommentAnchor =
  | { readonly node: NodeId }
  | { readonly item: string }
  | { readonly at: { readonly x: number; readonly y: number } };

/** One comment of a thread: what it says, by its node. */
export interface CanvasCommentText {
  readonly id: NodeId;
  readonly text: string;
}

/** A thread on a canvas: its first comment, where it is pinned, its replies and whether it is resolved. */
export interface CanvasThread extends CanvasCommentText {
  readonly canvas: NodeId;
  /** Null for a comment whose pin does not read: it is on the canvas, pinned nowhere. */
  readonly anchor: CommentAnchor | null;
  readonly resolved: boolean;
  /** Its replies, depth first, each a comment under it. */
  readonly replies: readonly CanvasCommentText[];
}

/** What a thread reads of a node: a store's `KbNode` and the page's outline node alike. */
export type CommentNode = Pick<KbNode, "id" | "text" | "props" | "children">;

/** Whether `node` is a comment: tagged `#comment`. */
export function isCommentNode(node: Pick<KbNode, "props">): boolean {
  return typeRefsOf(node).includes(CANVAS_IDS.commentTag);
}

/** A point written `x,y`, or null when it reads as none. */
function pointOf(text: string | undefined): { x: number; y: number } | null {
  const [x, y, ...rest] = (text ?? "").split(",").map((part) => Number(part.trim()));
  if (x === undefined || y === undefined || rest.length > 0) return null;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** Where `node` is pinned: the first of its node, item and point that it names. */
function anchorOf(node: Pick<KbNode, "props">): CommentAnchor | null {
  const about = refValuesOf(node, CANVAS_IDS.commentNodeField)[0];
  if (about !== undefined) return { node: about };
  const item = firstStr(CANVAS_IDS.commentItemField)(node.props)?.trim();
  if (item !== undefined && item !== "") return { item };
  const at = pointOf(firstStr(CANVAS_IDS.commentAtField)(node.props));
  return at === null ? null : { at };
}

/**
 * The threads on each canvas in `nodes`, by the canvas, each in the order
 * its first comment comes: what `CanvasWorld.threadsOn` answers.
 */
export function threadsByCanvas(
  nodes: ReadonlyMap<NodeId, CommentNode>,
): Map<NodeId, CanvasThread[]> {
  const repliesOf = (node: CommentNode): CanvasCommentText[] =>
    node.children.flatMap((id) => {
      const child = nodes.get(id);
      if (child === undefined || !isCommentNode(child)) return [];
      return [{ id: child.id, text: child.text }, ...repliesOf(child)];
    });
  const threads = new Map<NodeId, CanvasThread[]>();
  for (const node of nodes.values()) {
    const canvas = isCommentNode(node)
      ? refValuesOf(node, CANVAS_IDS.commentCanvasField)[0]
      : undefined;
    if (canvas === undefined) continue;
    const thread: CanvasThread = {
      id: node.id,
      text: node.text,
      canvas,
      anchor: anchorOf(node),
      resolved: refValuesOf(node, CANVAS_IDS.commentStateField)[0] === CANVAS_IDS.commentResolved,
      replies: repliesOf(node),
    };
    threads.set(canvas, [...(threads.get(canvas) ?? []), thread]);
  }
  return threads;
}

/**
 * The items of `doc` a thread is pinned on: each card showing its node, or
 * its item; none for a point, or for a pin the canvas no longer holds.
 */
export function pinnedItems(anchor: CommentAnchor, doc: CanvasDoc): CanvasNode[] {
  if ("node" in anchor) return doc.nodes.filter((item) => item.nodeId === anchor.node);
  if ("item" in anchor) return doc.nodes.filter((item) => item.id === anchor.item);
  return [];
}

/**
 * Whether a thread pinned at `anchor` has lost its pin on `doc`: its node
 * is on no card there, or its item is gone. A point is never lost.
 */
export function pinLost(anchor: CommentAnchor | null, doc: CanvasDoc): boolean {
  if (anchor === null) return true;
  return !("at" in anchor) && pinnedItems(anchor, doc).length === 0;
}

/**
 * The fields a new thread on `canvas` is written with, pinned at `anchor`
 * and open: the one statement of a thread's shape, which the verb and the
 * page both write.
 */
export function threadProps(
  canvas: NodeId,
  anchor: CommentAnchor,
): Readonly<Record<NodeId, PropValue>> {
  const pin: Record<NodeId, PropValue> =
    "node" in anchor
      ? { [CANVAS_IDS.commentNodeField]: { t: "ref", v: anchor.node } }
      : "item" in anchor
        ? { [CANVAS_IDS.commentItemField]: { t: "str", v: anchor.item } }
        : { [CANVAS_IDS.commentAtField]: { t: "str", v: `${anchor.at.x},${anchor.at.y}` } };
  return {
    [CANVAS_IDS.commentCanvasField]: { t: "ref", v: canvas },
    ...pin,
    [CANVAS_IDS.commentStateField]: { t: "ref", v: CANVAS_IDS.commentOpen },
  };
}

/** Where a comment on `item` is pinned: on its node when it is a card, else on it. */
export function anchorOnItem(item: CanvasNode): CommentAnchor {
  return item.nodeId === undefined ? { item: item.id } : { node: item.nodeId };
}
