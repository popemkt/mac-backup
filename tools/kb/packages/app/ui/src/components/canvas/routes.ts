import type { CanvasParams } from "@/components/canvas/views";
import type { NoParams } from "@/lib/plugins";

export function matchCanvasList(path: string): NoParams | null {
  return path === "/canvas" || path === "/canvas/" ? {} : null;
}

export function matchCanvas(path: string): CanvasParams | null {
  const id = /^\/canvas\/([^/]+)\/?$/.exec(path)?.[1];
  return id === undefined ? null : { id: decodeURIComponent(id) };
}
