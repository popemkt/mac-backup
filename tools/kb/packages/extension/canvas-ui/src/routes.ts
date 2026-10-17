import type { CanvasParams } from "@kb/canvas";
import type { NoParams } from "@kb/views";

/** The path of every canvas. */
export const CANVAS_LIST_PATH = "/canvas";

export function matchCanvasList(path: string): NoParams | null {
  return path === CANVAS_LIST_PATH || path === `${CANVAS_LIST_PATH}/` ? {} : null;
}

/** The path of one canvas: what {@link matchCanvas} reads back. */
export function canvasPath({ id }: CanvasParams): string {
  return `${CANVAS_LIST_PATH}/${encodeURIComponent(id)}`;
}

export function matchCanvas(path: string): CanvasParams | null {
  const id = /^\/canvas\/([^/]+)\/?$/.exec(path)?.[1];
  return id === undefined ? null : { id: decodeURIComponent(id) };
}
