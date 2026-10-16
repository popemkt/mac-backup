import type { GraphParams } from "@kb/graph";

/** `/graph` or `/graph/<perspective>`. */
export function matchGraph(path: string): GraphParams | null {
  if (path === "/graph" || path === "/graph/") return {};
  const perspective = /^\/graph\/([^/]+)\/?$/.exec(path)?.[1];
  return perspective === undefined ? null : { perspective: decodeURIComponent(perspective) };
}

/** The path `matchGraph` reads back: `/graph`, or `/graph/<perspective>` for one perspective. */
export function graphPath(perspectiveId?: string | null): string {
  if (perspectiveId !== null && perspectiveId !== undefined) {
    return `/graph/${encodeURIComponent(perspectiveId)}`;
  }
  return "/graph";
}
