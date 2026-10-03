/**
 * A chart's data in the browser: its source query node's rows, live, named
 * by the query's `:find` columns (`queryRecords`, the one naming the server's
 * text form uses too), capped as `chartRecords` caps every chart's rows.
 *
 * Chart code in the shell's lib: GAP [[01M41H30C2RSD2FGVYBT5HAG48]]
 */
import { useMemo } from "react";
import { queryDefOf, type PropValue } from "@kb/model";
import { chartRecords, type KbIndex, type QueryRecords } from "@/ds";
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
    return { kind: "rows", ...chartRecords(def, rows) };
  }, [input.source, def, rows, error]);
}
