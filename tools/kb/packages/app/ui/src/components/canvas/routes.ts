import type { CanvasParams, NoParams } from "@kb/views";

export function matchCanvasList(path: string): NoParams | null {
  return path === "/canvas" || path === "/canvas/" ? {} : null;
}

export function matchCanvas(path: string): CanvasParams | null {
  const id = /^\/canvas\/([^/]+)\/?$/.exec(path)?.[1];
  return id === undefined ? null : { id: decodeURIComponent(id) };
}
