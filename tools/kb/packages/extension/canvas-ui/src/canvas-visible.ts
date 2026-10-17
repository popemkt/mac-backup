import { edgeRoute, routePoints, type CanvasDoc, type CanvasNode } from "@kb/canvas";
import {
  projectPoint,
  screenBounds,
  type CanvasScreenPoint,
  type CanvasView,
  type ScreenRect,
  type ViewSize,
} from "./canvas-camera";

/**
 * Where `view` draws each item on a stage of `size`, in document order: the
 * screen bounds of its box (`screenBounds`), in whichever projection holds
 * the camera. An item none of which is in front of the eye has none.
 */
export function itemScreenRects(
  items: readonly CanvasNode[],
  view: CanvasView,
  size: ViewSize,
): Map<string, ScreenRect> {
  const rects = new Map<string, ScreenRect>();
  if (view.zoom <= 0 || size.width <= 0 || size.height <= 0) return rects;
  for (const item of items) {
    const drawn = screenBounds(view, size, item);
    if (drawn !== null) rects.set(item.id, drawn);
  }
  return rects;
}

/**
 * The ids of the items any part of which `view` draws inside a stage of
 * `size`, in document order: what the screen state reports as visible.
 */
export function visibleItemIds(
  items: readonly CanvasNode[],
  view: CanvasView,
  size: ViewSize,
): string[] {
  return [...itemScreenRects(items, view, size)]
    .filter(
      ([, drawn]) =>
        drawn.left < size.width && drawn.right > 0 && drawn.top < size.height && drawn.bottom > 0,
    )
    .map(([id]) => id);
}

/**
 * How wide an edge takes gestures on screen, CSS pixels: wider than any
 * edge is drawn, so nothing drawn over the canvas reaches its line.
 */
export const EDGE_REACH = 16;

/**
 * Where `view` draws each edge of `doc` whose two ends are on it, as a line
 * on screen: its route (`edgeRoute`, `routePoints`, the path both
 * projections draw), each point projected through the camera, those behind
 * the eye left out.
 */
export function edgeScreenLines(
  doc: CanvasDoc,
  view: CanvasView,
  size: ViewSize,
): { readonly id: string; readonly points: CanvasScreenPoint[] }[] {
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  return doc.edges.flatMap((edge) => {
    const from = byId.get(edge.fromNode);
    const to = byId.get(edge.toNode);
    if (from === undefined || to === undefined) return [];
    const points = routePoints(edgeRoute(from, to, edge))
      .map((point) => projectPoint(view, size, point))
      .filter((point) => point !== null);
    return points.length < 2 ? [] : [{ id: edge.id, points }];
  });
}
