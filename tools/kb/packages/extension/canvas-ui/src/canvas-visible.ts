import type { CanvasNode } from "@kb/canvas";
import { screenBounds, type CanvasView, type ViewSize } from "./canvas-camera";

/**
 * The ids of the items any part of which `view` draws inside a stage of
 * `size`, in document order: what the screen state reports as visible, in
 * whichever projection holds the camera.
 */
export function visibleItemIds(
  items: readonly CanvasNode[],
  view: CanvasView,
  size: ViewSize,
): string[] {
  if (view.zoom <= 0 || size.width <= 0 || size.height <= 0) return [];
  return items
    .filter((item) => {
      const drawn = screenBounds(view, size, item);
      return (
        drawn !== null &&
        drawn.left < size.width &&
        drawn.right > 0 &&
        drawn.top < size.height &&
        drawn.bottom > 0
      );
    })
    .map((item) => item.id);
}
