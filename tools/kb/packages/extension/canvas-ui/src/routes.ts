import type { CanvasParams } from "@kb/canvas";
import type { NoParams } from "@kb/views";

/** The path of every canvas. */
export const CANVAS_LIST_PATH = "/canvas";

export function matchCanvasList(path: string): NoParams | null {
  return path === CANVAS_LIST_PATH || path === `${CANVAS_LIST_PATH}/` ? {} : null;
}

/** The path of one canvas, and of an item on it: what {@link matchCanvas} reads back. */
export function canvasPath({ id, item }: CanvasParams): string {
  const base = `${CANVAS_LIST_PATH}/${encodeURIComponent(id)}`;
  return item === undefined ? base : `${base}/${encodeURIComponent(item)}`;
}

export function matchCanvas(path: string): CanvasParams | null {
  const match = /^\/canvas\/([^/]+)(?:\/([^/]+))?\/?$/.exec(path);
  if (match?.[1] === undefined) return null;
  const id = decodeURIComponent(match[1]);
  return match[2] === undefined ? { id } : { id, item: decodeURIComponent(match[2]) };
}
