import type { SurfaceParams } from "@/lib/plugins";

/** The graph plugin's namespace and surface ids, derived once. */
export const GRAPH_NAMESPACE = "graph";
export const GRAPH_PAGE = "page";
/** `graph.page`: `/graph` or `/graph/<perspective>`; `ontology` scopes it when embedded. */
export const GRAPH_SURFACE = `${GRAPH_NAMESPACE}.${GRAPH_PAGE}`;

export function matchGraph(path: string): SurfaceParams | null {
  if (path === "/graph" || path === "/graph/") return {};
  const perspective = /^\/graph\/([^/]+)\/?$/.exec(path)?.[1];
  return perspective === undefined ? null : { perspective: decodeURIComponent(perspective) };
}
