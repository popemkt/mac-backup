/**
 * A chart view on a text surface: what it draws (its mark and encoding),
 * then its data as a table, and on a page its SVG, painted by the painter the
 * host's entry hands the family (DESIGN.md → Extension families → a painter
 * belongs to the view that paints with it). A host with none draws the text
 * alone.
 */
import { Effect } from "effect";
import type { KbContext, ViewText } from "@kb/contracts";
import { queryDefOf, type DomainError } from "@kb/model";
import type { QueryRecords } from "@kb/query";
import { chartRecords } from "./records.ts";
import { chartSpecWithData, describeChartSpec, type ChartParams } from "./view.ts";

/**
 * Draws a chart as SVG where no browser does: what a page of a chart view
 * shows above its text (DESIGN.md → View nodes → Chart views).
 *
 * The promise, which every painter keeps: `svg` takes a Vega-Lite spec whose
 * data is inline (`data.values`) and succeeds with one SVG document; it
 * fetches nothing (a URL in the spec draws as nothing) and compiles no code,
 * so a stored spec runs no script and reaches no network.
 */
export interface ChartPainter {
  svg(spec: Readonly<Record<string, unknown>>): Effect.Effect<string, DomainError>;
}

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

/** A chart view's figure on a page: its SVG, painted by `painter`. */
function chartFigure(painter: ChartPainter): NonNullable<ViewText<ChartParams>["figure"]> {
  return Effect.fn("chart.figure")(function* (ctx: KbContext, params: ChartParams) {
    // GAP [[01M41TZJ2AG28C2X2DECZ25CN6]]
    const data = chartRecordsOf(ctx, params.source);
    if ("missing" in data) return null;
    return yield* painter
      .svg(chartSpecWithData(params.spec, data.records, PAGE_BOX))
      .pipe(Effect.orElseSucceed(() => null));
  });
}

/**
 * How a chart view says itself in text: its body, and with a painter its
 * page figure. The chart's `ViewDef.text`, as the family's plugin contributes
 * it for a host's painter.
 */
export function chartText(painter: ChartPainter | null): ViewText<ChartParams> {
  return painter === null ? { body: chartBody } : { body: chartBody, figure: chartFigure(painter) };
}
