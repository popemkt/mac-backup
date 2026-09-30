import type { CanvasNode } from "@kb/canvas";

/** The 2D canvas camera: screen = pan + canvas × zoom (`canvas-stage`'s transform). */
export interface CanvasView2d {
  readonly pan: { readonly x: number; readonly y: number };
  readonly zoom: number;
  /** The stage's size on screen, in pixels. */
  readonly width: number;
  readonly height: number;
}

/** The ids of the items any part of which is inside the stage, in document order. */
export function visibleItemIds(items: readonly CanvasNode[], view: CanvasView2d): string[] {
  if (view.zoom <= 0 || view.width <= 0 || view.height <= 0) return [];
  const left = -view.pan.x / view.zoom;
  const top = -view.pan.y / view.zoom;
  const right = left + view.width / view.zoom;
  const bottom = top + view.height / view.zoom;
  return items
    .filter(
      (item) =>
        item.x < right &&
        item.x + item.width > left &&
        item.y < bottom &&
        item.y + item.height > top,
    )
    .map((item) => item.id);
}
