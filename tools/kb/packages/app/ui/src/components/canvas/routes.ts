import type { SurfaceParams } from "@/lib/plugins";

/** The canvas plugin's namespace and surface ids, derived once. */
export const CANVAS_NAMESPACE = "canvas";
export const CANVAS_LIST = "list";
export const CANVAS_PAGE = "page";
export const CANVAS_LIST_SURFACE = `${CANVAS_NAMESPACE}.${CANVAS_LIST}`;
export const CANVAS_SURFACE = `${CANVAS_NAMESPACE}.${CANVAS_PAGE}`;

export function matchCanvasList(path: string): SurfaceParams | null {
  return path === "/canvas" || path === "/canvas/" ? {} : null;
}

export function matchCanvas(path: string): SurfaceParams | null {
  const id = /^\/canvas\/([^/]+)\/?$/.exec(path)?.[1];
  return id === undefined ? null : { id: decodeURIComponent(id) };
}
