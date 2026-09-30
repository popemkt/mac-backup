/**
 * The browser's query seam: one {@link KbIndex} replica, not a second
 * DataScript builder. Construction stays in the outline store; every other
 * UI module runs queries and backlinks through this file.
 */
import { backlinksQuery, neighbourhoodQuery, type KbIndex } from "@kb/query";

export type { KbIndex } from "@kb/query";
export { DatascriptIndex, nodeMentions } from "@kb/query";

export const runQuery = (ix: KbIndex, edn: string): unknown[][] => ix.runDatalog(edn);

/**
 * Nodes that reference `targetId`. The EDN comes from `@kb/query` —
 * one owner for "what references X", so the CLI's `kb backlinks` and the
 * UI's References section cannot answer it differently.
 */
export function queryBacklinks(ix: KbIndex, targetId: string): Array<{ id: string; text: string }> {
  return runQuery(ix, backlinksQuery(targetId)).flatMap((row: unknown[]) =>
    Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "string"
      ? [{ id: row[0], text: row[1] }]
      : [],
  );
}

/** The first column of `edn`'s rows, as the node ids they name. */
function queryIds(ix: KbIndex, edn: string): string[] {
  return runQuery(ix, edn).flatMap((row: unknown[]) =>
    Array.isArray(row) && typeof row[0] === "string" ? [row[0]] : [],
  );
}

/**
 * `root` and the nodes within `hops` of it along any of `edges` (node-valued
 * attributes), in either direction. The EDN is `@kb/query`'s
 * `neighbourhoodQuery`, run once per edge and direction and unioned here,
 * because the union as one query needs `or`, which runs raw.
 * GAP [[01M39X8RPQBWFVDNG77BB3ZCMH]]
 */
export function queryNeighbourhood(
  ix: KbIndex,
  root: string,
  hops: number,
  edges: readonly string[],
): Set<string> {
  const ids = new Set([root]);
  for (const edge of edges) {
    for (const direction of ["out", "in"] as const) {
      for (const id of queryIds(ix, neighbourhoodQuery(root, hops, edge, direction))) ids.add(id);
    }
  }
  return ids;
}
