/**
 * The rows a chart draws: its query's rows as records (`@kb/query`'s
 * `queryRecords`, which names any query's columns), capped. One cap, so the
 * browser that draws a chart and the server that paints its page draw the
 * same rows.
 */
import type { QueryNodeDef } from "@kb/model";
import { queryRecords, type QueryRecords } from "@kb/query";

/**
 * The most rows a chart draws, whatever its query's own limit: a query with
 * none would otherwise hand every row to Vega, in the browser and in the
 * server's SVG snapshot alike.
 */
export const MAX_CHART_ROWS = 5000;

/**
 * The rows a query node's chart draws, as records: capped at the node's
 * `sys.f.query.limit` and at {@link MAX_CHART_ROWS}, whichever is lower. The
 * one cap every runtime applies.
 */
export function chartRecords(
  def: QueryNodeDef,
  rows: readonly (readonly unknown[])[],
): QueryRecords {
  const cap = Math.min(def.limit ?? MAX_CHART_ROWS, MAX_CHART_ROWS);
  return queryRecords(def.edn, rows.length > cap ? rows.slice(0, cap) : rows);
}
