/**
 * A chart's data in the browser: its source query node's rows, live, named
 * by the query's `:find` columns (`queryRecords`, the one naming the server's
 * text form uses too), capped at the query's limit.
 */
import { useMemo } from "react";
import { queryDefOf, type PropValue } from "@kb/model";
import { queryRecords, type KbIndex, type QueryRecords } from "@/ds";
import { useQueryNodeRows } from "@/lib/use-query-node-rows";

export type ChartData =
  /** There is nothing to draw, and why: no source, or a source that is no query node. */
  | { readonly kind: "missing"; readonly reason: "no-source" | "no-query" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | ({ readonly kind: "rows" } & QueryRecords);

/** The rows the chart draws for its `source` node (null for none), from whichever source answers. */
export function useChartData(input: {
  readonly source: { readonly id: string; readonly props: Record<string, PropValue[]> } | null;
  readonly live: boolean;
  readonly index: KbIndex | null;
  readonly generation: number;
}): ChartData {
  const def = useMemo(() => queryDefOf(input.source ?? undefined), [input.source]);
  const { rows, error } = useQueryNodeRows({
    nodeId: input.source?.id ?? "",
    edn: def?.edn ?? null,
    live: input.live,
    index: input.index,
    generation: input.generation,
  });
  return useMemo((): ChartData => {
    if (input.source === null) return { kind: "missing", reason: "no-source" };
    if (def === null) return { kind: "missing", reason: "no-query" };
    if (error !== null) return { kind: "error", message: error };
    if (rows === null) return { kind: "loading" };
    const capped = def.limit === null ? rows : rows.slice(0, def.limit);
    return { kind: "rows", ...queryRecords(def.edn, capped) };
  }, [input.source, def, rows, error]);
}
