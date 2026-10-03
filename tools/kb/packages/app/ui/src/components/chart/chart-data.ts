/**
 * A chart's data in the browser: its source query node's rows, live, named
 * by the query's `:find` columns (`queryRecords`, the one naming the server's
 * text form uses too), capped as `chartRecords` caps every chart's rows.
 */
import { useMemo } from "react";
import { queryDefOf, type PropValue } from "@kb/model";
import { chartRecords } from "@kb/chart";
import { useQueryRows, type QueryRecords } from "@/sdk";

export type ChartData =
  /** There is nothing to draw, and why: no source, or a source that is no query node. */
  | { readonly kind: "missing"; readonly reason: "no-source" | "no-query" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | ({ readonly kind: "rows" } & QueryRecords);

/** The rows the chart draws for its `source` node (null for none), from whichever source answers. */
export function useChartData(
  source: { readonly id: string; readonly props: Record<string, PropValue[]> } | null,
): ChartData {
  const def = useMemo(() => queryDefOf(source ?? undefined), [source]);
  const { rows, error } = useQueryRows({
    nodeId: source?.id ?? "",
    edn: def?.edn ?? null,
  });
  return useMemo((): ChartData => {
    if (source === null) return { kind: "missing", reason: "no-source" };
    if (def === null) return { kind: "missing", reason: "no-query" };
    if (error !== null) return { kind: "error", message: error };
    if (rows === null) return { kind: "loading" };
    return { kind: "rows", ...chartRecords(def, rows) };
  }, [source, def, rows, error]);
}
