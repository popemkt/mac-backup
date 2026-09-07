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
