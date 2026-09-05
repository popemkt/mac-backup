/**
 * The browser's query seam: one {@link KbIndex} replica, not a second
 * DataScript builder. Construction stays in the outline store; every other
 * UI module runs queries and backlinks through this file.
 */
import { backlinksQuery, type KbIndex } from "@kb/query";

export type { KbIndex } from "@kb/query";
export { DatascriptIndex, extractMentions } from "@kb/query";

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
