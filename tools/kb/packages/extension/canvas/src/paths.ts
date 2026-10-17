/**
 * A path item drawn (`CanvasPathNode`, `./doc.ts`): the line through its
 * points across its box, and the heads its ends wear — the same heads an
 * edge wears (`headOnLine`, `./edges.ts`). An item's outline is one answer
 * for every kind (`itemOutline`): a path's line, or the outline its shape
 * draws (`shapeOutline`), so both projections draw a line with the chrome
 * every other item is drawn with.
 */
import {
  isPathNode,
  type CanvasAnchor,
  type CanvasHead,
  type CanvasNode,
  type CanvasPathNode,
} from "./doc.ts";
import { headOf, headOnLine, withHead, type EdgeEnd, type EdgeHead } from "./edges.ts";
import { dropExtra } from "./extra.ts";
import { itemShape, shapeOutline, type CanvasPathCommand } from "./shapes.ts";

/** A path's points in a `w` × `h` box, its own units. */
function pathPoints(item: CanvasPathNode, w: number, h: number) {
  return item.points.map((p) => ({ x: p.x * w, y: p.y * h, z: 0 }));
}

/** The line through a path's points in a `w` × `h` box, back to its first when closed. */
function pathOutline(item: CanvasPathNode, w: number, h: number): CanvasPathCommand[] {
  const [first, ...rest] = pathPoints(item, w, h);
  if (first === undefined) return [];
  return [
    ["M", first.x, first.y],
    ...rest.map((p): CanvasPathCommand => ["L", p.x, p.y]),
    ...(item.closed === true ? [["Z"] as const] : []),
  ];
}

/**
 * The outline `item` draws filling a `w` × `h` box: a path's line through
 * its points, or the outline of its shape (`radius` rounding a
 * rectangle's corners). What both projections stroke as its chrome.
 */
export function itemOutline(item: CanvasNode, w: number, h: number, radius: number) {
  return isPathNode(item) ? pathOutline(item, w, h) : shapeOutline(itemShape(item), w, h, radius);
}

/** Whether `item` is a line that runs open, end to end: one that wears heads, and no fill. */
export function isOpenLine(item: CanvasNode): item is CanvasPathNode {
  return isPathNode(item) && item.closed !== true;
}

/** A change of a line: its points, whether it closes, and each end's head (null for none). */
export interface CanvasLinePatch {
  readonly points?: readonly CanvasAnchor[];
  readonly closed?: boolean;
  readonly fromHead?: CanvasHead | null;
  readonly toHead?: CanvasHead | null;
}

/**
 * `item`, a line, changed as `patch` says: an open line, and an end with
 * no head, written as no field; one set here supersedes a value this
 * version could not read.
 */
export function withLine(item: CanvasPathNode, patch: CanvasLinePatch): CanvasPathNode {
  let next: CanvasPathNode = { ...item };
  if (patch.points !== undefined) next = { ...dropExtra(next, "points"), points: patch.points };
  if (patch.closed !== undefined) {
    next = dropExtra(next, "closed");
    if (patch.closed) next.closed = true;
    else delete next.closed;
  }
  for (const [end, head] of [
    ["from", patch.fromHead],
    ["to", patch.toHead],
  ] as const) {
    if (head !== undefined) next = withHead(next, end, head);
  }
  return next;
}

/**
 * The heads an open path's ends wear in a `w` × `h` box, `length` long; a
 * closed path has no ends, so none.
 */
export function pathHeads(
  item: CanvasNode,
  w: number,
  h: number,
  length: number,
): { readonly end: EdgeEnd; readonly head: EdgeHead }[] {
  if (!isOpenLine(item)) return [];
  const points = pathPoints(item, w, h);
  return (["from", "to"] as const).flatMap((end) => {
    const kind = headOf(item, end);
    const head = kind === null ? null : headOnLine(kind, points, end, length);
    return head === null ? [] : [{ end, head }];
  });
}
