import type { GraphParams } from "@/components/graph/views";

/** `/graph` or `/graph/<perspective>`. */
export function matchGraph(path: string): GraphParams | null {
  if (path === "/graph" || path === "/graph/") return {};
  const perspective = /^\/graph\/([^/]+)\/?$/.exec(path)?.[1];
  return perspective === undefined ? null : { perspective: decodeURIComponent(perspective) };
}
