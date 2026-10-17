/**
 * A path item drawn (`CanvasPathNode`, `./doc.ts`): the line through its
 * points across its box, and the heads its ends wear — the same heads an
 * edge wears (`headOnLine`, `./edges.ts`). An item's outline is one answer
 * for every kind (`itemOutline`): a path's line, or the outline its shape
 * draws (`shapeOutline`), so both projections draw a line with the chrome
 * every other item is drawn with; what it wears beyond its outline (a
 * line's heads, a shape's own mark) are its marks (`itemMarks`), which
 * every painter inks as one.
 */
import {
  isPathNode,
  isShapeNode,
  parseLinePoints,
  type CanvasAnchor,
  type CanvasHead,
  type CanvasNode,
  type CanvasPathNode,
} from "./doc.ts";
import { headOf, headOnLine, withHead, type EdgeEnd, type EdgeHead } from "./edges.ts";
import { dropExtra } from "./extra.ts";
import { CanvasRelationError } from "./relations.ts";
import type { ItemPaint } from "./paint.ts";
import { itemShape, shapeMark, shapeOutline, type CanvasPathCommand } from "./shapes.ts";

/** A path's points in a `w` × `h` box, its own units. */
function pathPoints(item: CanvasPathNode, w: number, h: number) {
  return item.points.map((p) => ({ x: p.x * w, y: p.y * h, z: 0 }));
}

/** A point a line runs through, its own units. */
interface LinePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A smooth line through `points` (Catmull–Rom, as cubic curves): each piece
 * leaves a point heading along the line from the point before it to the
 * point after it, so a stroke drawn by hand reads as drawn, not as a
 * polyline; closed, it runs on round to its first. The one smoothing every
 * projection and the export draw a freehand line by (`itemOutline`).
 */
export function smoothThrough(points: readonly LinePoint[], closed: boolean): CanvasPathCommand[] {
  const [first] = points;
  if (first === undefined) return [];
  const n = points.length;
  const at = (i: number) => points[closed ? (i + n) % n : Math.min(Math.max(i, 0), n - 1)] ?? first;
  const pieces = Array.from({ length: closed ? n : n - 1 }, (_, i): CanvasPathCommand => {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    return [
      "C",
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    ];
  });
  return [["M", first.x, first.y], ...pieces, ...(closed ? [["Z"] as const] : [])];
}

/**
 * The line through a path's points in a `w` × `h` box, back to its first
 * when closed: straight between them, or smooth through them when drawn by
 * hand (`smoothThrough`).
 */
function pathOutline(item: CanvasPathNode, w: number, h: number): CanvasPathCommand[] {
  const points = pathPoints(item, w, h);
  const closed = item.closed === true;
  if (item.freehand === true) return smoothThrough(points, closed);
  const [first, ...rest] = points;
  if (first === undefined) return [];
  return [
    ["M", first.x, first.y],
    ...rest.map((p): CanvasPathCommand => ["L", p.x, p.y]),
    ...(closed ? [["Z"] as const] : []),
  ];
}

/** How near a stroke's point may come to the last one kept before it is dropped, canvas units. */
const STROKE_STEP = 2;

/**
 * The path item `id` for a stroke drawn by hand through `stroke` (canvas
 * points, in the order drawn), a highlighter's when `highlight`: its box
 * the stroke's bounds (at least a unit each way), its points those anchors
 * of it, each point nearer than `STROKE_STEP` to the last one kept dropped
 * (the last always kept). Null for a stroke that never left its first
 * point.
 */
export function freehandItem(
  id: string,
  stroke: readonly LinePoint[],
  highlight: boolean,
): CanvasPathNode | null {
  const kept: LinePoint[] = [];
  for (const [i, p] of stroke.entries()) {
    const last = kept.at(-1);
    const far = last === undefined || Math.hypot(p.x - last.x, p.y - last.y) >= STROKE_STEP;
    if (far) kept.push(p);
    else if (i === stroke.length - 1 && kept.length > 1) kept[kept.length - 1] = p;
  }
  if (kept.length < 2) return null;
  const xs = kept.map((p) => p.x);
  const ys = kept.map((p) => p.y);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  const [width, height] = [Math.max(1, Math.max(...xs) - x), Math.max(1, Math.max(...ys) - y)];
  return {
    id,
    type: "path",
    x,
    y,
    width,
    height,
    points: kept.map((p) => ({ x: (p.x - x) / width, y: (p.y - y) / height })),
    freehand: true,
    ...(highlight ? { highlight: true } : {}),
  };
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

/**
 * A mark an item wears in its outline's ink, beyond its outline: filled in
 * that ink, or stroked in it as heavy as the outline (at least 1).
 */
export interface CanvasMark {
  readonly path: readonly CanvasPathCommand[];
  readonly filled: boolean;
}

/**
 * The marks `item` wears filling a `w` × `h` box, as `paint` (its
 * `itemPaint`) says: the heads a line's open ends wear, and the mark a
 * shape wears of its own (`shapeMark`: a check box's tick), stroked. Every
 * painter draws them, after the outline, from here.
 */
export function itemMarks(item: CanvasNode, w: number, h: number, paint: ItemPaint): CanvasMark[] {
  const heads =
    paint.heads === null ? [] : pathHeads(item, w, h, paint.heads.length).map(({ head }) => head);
  const own = isShapeNode(item) ? shapeMark(item.shape, w, h) : null;
  return own === null ? heads : [...heads, { path: own, filled: false }];
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
 * version could not read. Throws `CanvasRelationError` for points the
 * format would not read back (`parseLinePoints`).
 */
export function withLine(item: CanvasPathNode, patch: CanvasLinePatch): CanvasPathNode {
  let next: CanvasPathNode = { ...item };
  if (patch.points !== undefined) {
    const points = parseLinePoints(patch.points);
    if (points === undefined) {
      throw new CanvasRelationError(
        "a line runs through two or more points of its box, each 0–1 across and down it",
      );
    }
    next = { ...dropExtra(next, "points"), points };
  }
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
