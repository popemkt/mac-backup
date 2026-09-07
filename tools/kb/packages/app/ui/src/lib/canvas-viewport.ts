export interface CanvasPoint {
  x: number;
  y: number;
}

/** Client coordinates always enter through the untransformed viewport. */
export function clientToCanvas(
  point: CanvasPoint,
  viewport: { left: number; top: number },
  pan: CanvasPoint,
  zoom: number,
): CanvasPoint {
  return {
    x: (point.x - viewport.left - pan.x) / zoom,
    y: (point.y - viewport.top - pan.y) / zoom,
  };
}

/**
 * Zoom bounds and step, owned here because every surface that changes zoom —
 * the wheel, the keymap, zoom-to-fit — has to agree on them.
 */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;
export const ZOOM_STEP = 1.15;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}
