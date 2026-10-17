import type { CanvasNode } from "@kb/canvas";
import { screenBounds, type CanvasView, type ScreenRect, type ViewSize } from "./canvas-camera";

/**
 * Where `view` draws each item on a stage of `size`, in document order: the
 * screen bounds of its box (`screenBounds`), in whichever projection holds
 * the camera. An item none of which is in front of the eye has none.
 */
function itemScreenRects(
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
