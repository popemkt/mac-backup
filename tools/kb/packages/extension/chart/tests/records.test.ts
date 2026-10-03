/**
 * A chart draws its query's rows capped: at the query's own limit, and never
 * past MAX_CHART_ROWS, so no surface hands Vega every row.
 */
import { describe, expect, test } from "bun:test";
import { MAX_CHART_ROWS, chartRecords } from "@kb/chart";

describe("chartRecords", () => {
  const edn = "[:find ?n :where [?e :node/id ?n]]";
  const rows = Array.from({ length: MAX_CHART_ROWS + 10 }, (_, i) => [`n${String(i)}`]);

  test("a chart draws at most its query's limit", () => {
    expect(chartRecords({ edn, limit: 3 }, rows).records).toHaveLength(3);
  });

  test("a query with no limit still draws at most MAX_CHART_ROWS", () => {
    expect(chartRecords({ edn, limit: null }, rows).records).toHaveLength(MAX_CHART_ROWS);
  });

  test("a limit above the cap is held to the cap", () => {
    expect(chartRecords({ edn, limit: MAX_CHART_ROWS * 2 }, rows).records).toHaveLength(
      MAX_CHART_ROWS,
    );
  });
});
