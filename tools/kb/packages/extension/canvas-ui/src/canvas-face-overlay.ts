/**
 * A face's editor laid over the 3D canvas: the item's own DOM face, placed
 * exactly on the plane its face is drawn on as the camera shows it, however
 * the item is turned or tipped — not a rectangle that only fits face-on. The
 * face's four corners go through the one camera model (`projectPoint`), and
 * the element is mapped onto them by the projective transform that takes a
 * rectangle to any four points (a homography, as CSS `matrix3d`). Through
 * either lens and in the middle of a flight it stays on the face.
 */
import {
  frameCorners,
  isKbNode,
  isShapeNode,
  isTextNode,
  type CanvasFrame,
  type CanvasNode,
} from "@kb/canvas";
import { projectPoint, type CanvasView, type ViewSize } from "./canvas-camera";

/** Whether `item` has an editor a face can open: words of its own, a shape's label, or a card's node text. */
export function hasEditor(item: CanvasNode): boolean {
  return isTextNode(item) || isShapeNode(item) || isKbNode(item);
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Twice the signed area of a quad on screen: positive when it runs clockwise (y down), as a face seen from its front does. */
function signedArea(quad: readonly Point[]): number {
  let sum = 0;
  quad.forEach((p, i) => {
    const q = quad[(i + 1) % quad.length] ?? p;
    sum += p.x * q.y - q.x * p.y;
  });
  return sum;
}

/**
 * The CSS `matrix3d` (with `transform-origin: 0 0`) that lays an element of
 * `width` × `height` onto the screen quad `quad` — its top left, top right,
 * bottom right and bottom left corners land on the four points in that
 * order. Null for a quad that is degenerate.
 */
export function quadTransform(
  width: number,
  height: number,
  [p0, p1, p2, p3]: readonly [Point, Point, Point, Point],
): string | null {
  // The unit square onto the quad (Heckbert's square-to-quad), then scaled to the element.
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-9 || width <= 0 || height <= 0) return null;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  const columns = [
    [a / width, d / width, 0, g / width],
    [b / height, e / height, 0, h / height],
    [0, 0, 1, 0],
    [p0.x, p0.y, 0, 1],
  ];
  return `matrix3d(${columns.flat().join(", ")})`;
}

/**
 * Where an element the size of a face of `frame` goes on screen through
 * `view`: the `matrix3d` laying it on the face's projected corners, or null
 * when a corner is behind the eye or the face is seen from behind (its words
 * would read mirrored).
 */
export function faceTransform(frame: CanvasFrame, view: CanvasView, size: ViewSize): string | null {
  const projected = frameCorners(frame)
    .slice(0, 4)
    .map((corner) => projectPoint(view, size, corner));
  const quad = projected.filter((p) => p !== null);
  const [p0, p1, p2, p3] = quad;
  if (quad.length < projected.length || !p0 || !p1 || !p2 || !p3) return null;
  if (signedArea(quad) <= 0) return null;
  return quadTransform(frame.half.x * 2, frame.half.y * 2, [p0, p1, p2, p3]);
}
