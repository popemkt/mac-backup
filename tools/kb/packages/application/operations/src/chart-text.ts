/**
 * A chart view on a text surface: what it draws (its mark and encoding),
 * then its data as a table, and on a page its SVG, painted by whichever
 * `ChartSvg` the runtime provides (none draws the text alone).
 *
 * The chart's text is contributed as its `ViewDef.text`, but it still lives in
 * core's operations: GAP [[01M41H2ZG7C0SV1DYZE6MMKPFE]]
 */
import { Effect } from "effect";
import { ChartSvg, type KbContext, type ViewText } from "@kb/contracts";
import { queryDefOf } from "@kb/model";
import { chartRecords, type QueryRecords } from "@kb/query";
import { chartSpecWithData, describeChartSpec, type ChartParams } from "@kb/views";

/** How many of a chart's rows its table lists. */
const MAX_TABLE_ROWS = 50;

/** The box a page draws a chart in: no browser measures one, so it is fixed. */
const PAGE_BOX = { width: 560, height: 300 };

/** The rows a chart draws, or why it has none. */
function chartRecordsOf(
  ctx: KbContext,
  source: string | undefined,
): QueryRecords | { readonly missing: string } {
  if (source === undefined)
    return { missing: "It names no query node: show it for one, or set its lens.focus." };
  const node = ctx.index.getNode(source);
  const def = queryDefOf(node);
  const name = node === undefined ? source : `${node.text.trim() || source} (${source})`;
  if (def === null)
    return { missing: `${name} is no query node with a query, so it draws nothing.` };
  try {
    const rows = ctx.index.runDatalog(def.edn);
    return chartRecords(def, rows);
  } catch (err) {
    return {
      missing: `${name}'s query cannot be run: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** A value as one table cell: text as it is, anything else as JSON, `|` escaped. */
function cell(value: unknown): string {
  const text =
    value === undefined || value === null
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/** The rows as a markdown table, the first {@link MAX_TABLE_ROWS} of them. */
function dataTable({ columns, records }: QueryRecords): readonly string[] {
  if (records.length === 0) return ["No rows."];
  const lines = [
    `| ${columns.map(cell).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...records
      .slice(0, MAX_TABLE_ROWS)
      .map((record) => `| ${columns.map((column) => cell(record[column])).join(" | ")} |`),
  ];
  if (records.length > MAX_TABLE_ROWS)
    lines.push("", `And ${String(records.length - MAX_TABLE_ROWS)} more rows.`);
  return lines;
}

/** A chart view's body: its encoding, then its data. */
function chartBody(ctx: KbContext, params: ChartParams): readonly string[] {
  const data = chartRecordsOf(ctx, params.source);
  const lines = ["", "## Chart", "", ...describeChartSpec(params.spec), "", "## Data", ""];
  if ("missing" in data) return [...lines, data.missing];
  const source = ctx.index.getNode(params.source ?? "");
  const named =
    source === undefined ? "" : `The rows of ${source.text.trim() || source.id} (${source.id}).`;
  return [...lines, named, "", ...dataTable(data)];
}

/** A chart view's figure on a page: its SVG, painted by the runtime's `ChartSvg`, if any. */
const chartFigure = Effect.fn("chart.figure")(function* (ctx: KbContext, params: ChartParams) {
  const painter = yield* ChartSvg;
  if (painter === null) return null;
  const data = chartRecordsOf(ctx, params.source);
  if ("missing" in data) return null;
  return yield* painter
    .svg(chartSpecWithData(params.spec, data.records, PAGE_BOX))
    .pipe(Effect.orElseSucceed(() => null));
});

/** How a chart view says itself in text: the chart's contribution of its `ViewDef.text`. */
export const chartText: ViewText<ChartParams> = { body: chartBody, figure: chartFigure };
