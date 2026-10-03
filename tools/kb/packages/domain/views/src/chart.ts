/**
 * The chart view type (roadmap decision 10): a query node's rows drawn by a
 * Vega-Lite spec. The spec is the view's settings, plain JSON, so an agent
 * writes a chart through `view.propose` and the catalog's JSON Schema
 * describes it; the rows are the query's, never the spec's. DESIGN.md →
 * Kinds, roles and options → Chart views states the model; this module is its
 * vocabulary: the key, the spec's shape, the data binding and the starter.
 */
import { Predicate, Schema } from "effect";
import { SYSTEM_IDS, canonicalJson, firstRef, firstStr } from "@kb/model";
import { encodeLensConfig } from "./lens.ts";
import { viewKey, type ConfigReport } from "./view-key.ts";

/** The chart plugin's namespace and view key: what a host imports, never the component. */
export const CHART_NAMESPACE = "chart";

/** The marks Vega-Lite draws, by the name a spec gives them. */
export const CHART_MARKS = [
  "arc",
  "area",
  "bar",
  "boxplot",
  "circle",
  "errorband",
  "errorbar",
  "image",
  "line",
  "point",
  "rect",
  "rule",
  "square",
  "text",
  "tick",
  "trail",
] as const;

/** A JSON object whose keys Vega-Lite owns: kb checks its shape, not its every property. */
const JsonObject = Schema.Record(Schema.String, Schema.Unknown);
const JsonObjects = Schema.Array(JsonObject);

const VegaLiteSchemaUrl = Schema.String.check(
  Schema.makeFilter(
    (url: string) =>
      /^https:\/\/vega\.github\.io\/schema\/vega-lite\/v\d+(\.\d+)*\.json$/.test(url),
    { expected: "a Vega-Lite schema URL (https://vega.github.io/schema/vega-lite/v6.json)" },
  ),
);

const Size = Schema.Union([Schema.Finite, Schema.Literal("container"), JsonObject]);

/** Where a chart's settings may name data of their own, which they may not. */
const OWN_DATA_KEYS = new Set(["data", "datasets"]);

/**
 * Every place under `value` that names data of its own or a URL, each at its
 * path: a chart's data is its query's rows, and a stored spec fetches nothing.
 */
function ownDataIssues(
  value: unknown,
  path: readonly PropertyKey[],
): { readonly path: readonly PropertyKey[]; readonly issue: string }[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => ownDataIssues(item, [...path, i]));
  if (!Predicate.isObject(value)) return [];
  return Object.entries(value).flatMap(([key, inner]) => {
    const at = [...path, key];
    if (OWN_DATA_KEYS.has(key))
      return [{ path: at, issue: "a chart's data is its query's rows, so a spec holds none" }];
    if (key === "url")
      return [{ path: at, issue: "a chart fetches nothing, so a spec names no url" }];
    return ownDataIssues(inner, at);
  });
}

/** The keys that make a spec draw something: a mark, or a composition of views. */
const DRAWS = ["mark", "layer", "concat", "hconcat", "vconcat", "facet", "repeat"] as const;

/**
 * A Vega-Lite spec as a chart's settings: the top-level keys Vega-Lite
 * defines, less its data, each checked for its shape; what lies inside them
 * is Vega-Lite's to read. Plain JSON, so it is stored and proposed as it is.
 */
export const ChartSpec = Schema.Struct({
  $schema: Schema.optionalKey(VegaLiteSchemaUrl),
  title: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String), JsonObject])),
  description: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  mark: Schema.optionalKey(Schema.Union([Schema.Literals(CHART_MARKS), JsonObject])),
  encoding: Schema.optionalKey(JsonObject),
  transform: Schema.optionalKey(JsonObjects),
  params: Schema.optionalKey(JsonObjects),
  projection: Schema.optionalKey(JsonObject),
  layer: Schema.optionalKey(JsonObjects),
  concat: Schema.optionalKey(JsonObjects),
  hconcat: Schema.optionalKey(JsonObjects),
  vconcat: Schema.optionalKey(JsonObjects),
  facet: Schema.optionalKey(JsonObject),
  repeat: Schema.optionalKey(Schema.Union([Schema.Array(Schema.String), JsonObject])),
  spec: Schema.optionalKey(JsonObject),
  columns: Schema.optionalKey(Schema.Finite),
  resolve: Schema.optionalKey(JsonObject),
  spacing: Schema.optionalKey(Schema.Union([Schema.Finite, JsonObject])),
  align: Schema.optionalKey(Schema.Union([Schema.String, JsonObject])),
  bounds: Schema.optionalKey(Schema.String),
  center: Schema.optionalKey(Schema.Union([Schema.Boolean, JsonObject])),
  width: Schema.optionalKey(Size),
  height: Schema.optionalKey(Size),
  autosize: Schema.optionalKey(Schema.Union([Schema.String, JsonObject])),
  padding: Schema.optionalKey(Schema.Union([Schema.Finite, JsonObject])),
  background: Schema.optionalKey(Schema.String),
  view: Schema.optionalKey(JsonObject),
  config: Schema.optionalKey(JsonObject),
  usermeta: Schema.optionalKey(JsonObject),
})
  .annotate({
    description:
      "A Vega-Lite (v6) spec, as JSON: a mark (bar, line, point, area, arc, …) with an encoding, or a composition (layer, concat, hconcat, vconcat, facet, repeat). Its data is the chart's query's rows, one object per row keyed by the query's :find names (?status is status, (count ?n) is count_n), so the spec holds no data, datasets or url anywhere. Width defaults to the box it is drawn in; colours, faces and sizes come from kb's theme unless config says otherwise.",
  })
  .check(
    Schema.makeFilter(
      (spec: object) =>
        DRAWS.some((key) => key in spec) || `draws nothing: give it one of ${DRAWS.join(", ")}`,
    ),
    Schema.makeFilter((spec: object) => ownDataIssues(spec, [])),
  );
export type ChartSpec = typeof ChartSpec.Type;

/**
 * A chart's settings: its spec, and the query node whose rows it draws
 * (`source`). Stored, the source is `lens.focus`, else the node the chart is
 * shown for, so one chart view node named by many query nodes draws each.
 */
export const ChartParams = Schema.Struct({
  source: Schema.optionalKey(Schema.NonEmptyString),
  spec: ChartSpec,
}).annotate({
  description:
    "A chart: the rows of a query node drawn by a Vega-Lite spec. source is the query node (stored as lens.focus, else the node it is shown for); spec is the Vega-Lite spec, whose data is that query's rows. A chart view node holding no spec draws the count of its rows.",
});
export type ChartParams = typeof ChartParams.Type;

/** A Vega-Lite column the way a query names it: an id is a key, not a category. */
function isIdColumn(column: string): boolean {
  return /(^|[_.-])id$/i.test(column) || column.startsWith("pull_");
}

/** Whether a query column already holds a measure: an aggregate it computed. */
function isMeasureColumn(column: string): boolean {
  return /^(count|count-distinct|sum|avg|median|min|max|variance|stddev)_/.test(column);
}

/**
 * The spec a new chart starts from, for a query with `columns`: its first
 * measure column (an aggregate the query computed) by its first other
 * category column, else the count of rows by that category, else the count of
 * rows. With no columns it is the count of rows: what a chart view node
 * holding no spec draws.
 */
export function starterChartSpec(columns: readonly string[]): ChartSpec {
  const measure = columns.find(isMeasureColumn);
  const category = columns.find((column) => !isMeasureColumn(column) && !isIdColumn(column));
  const y =
    measure === undefined
      ? { aggregate: "count", type: "quantitative", title: "Rows" }
      : { field: measure, type: "quantitative" };
  return category === undefined
    ? { mark: "bar", encoding: { y } }
    : { mark: "bar", encoding: { x: { field: category, type: "nominal", sort: "-y" }, y } };
}

/** The spec a view node holds, read out of its text, else nothing to read. */
function readSpec(raw: string | undefined, report: ConfigReport): { spec?: unknown } {
  if (raw === undefined || raw.trim() === "") return { spec: starterChartSpec([]) };
  try {
    return { spec: JSON.parse(raw) as unknown };
  } catch {
    report(`${SYSTEM_IDS.chartField} is not JSON`);
    return {};
  }
}

/**
 * A chart view: a view node naming `chart.vega-lite`, whose spec is one text
 * prop (`sys.f.chart`) holding it as canonical JSON, and whose source is its
 * `lens.focus`, else the node it is shown for.
 */
export const ChartView = viewKey(`${CHART_NAMESPACE}.vega-lite`, ChartParams, {
  read: (props, host, report) => {
    const source = firstRef(SYSTEM_IDS.lensFocusField)(props) ?? host ?? undefined;
    return {
      ...(source === undefined ? {} : { source }),
      ...readSpec(firstStr(SYSTEM_IDS.chartField)(props), report),
    };
  },
  write: ({ source, spec }) => ({
    ...(source === undefined ? {} : encodeLensConfig({ focus: source })),
    [SYSTEM_IDS.chartField]: [{ t: "str", v: canonicalJson(spec) }],
  }),
});

/**
 * The spec Vega-Lite compiles: `spec` with the query's rows as its data
 * (`data.values`), and the box's width unless the spec sets one. The rows are
 * the only data a chart draws.
 */
export function chartSpecWithData(
  spec: ChartSpec,
  records: readonly Readonly<Record<string, unknown>>[],
): Record<string, unknown> {
  const sized = DRAWS.slice(1).some((key) => key in spec) || "width" in spec;
  return { ...spec, ...(sized ? {} : { width: "container" }), data: { values: records } };
}

/** What a mark is called: its name, or its definition's `type`. */
function markName(mark: unknown): string | null {
  if (typeof mark === "string") return mark;
  return Predicate.isObject(mark) && typeof mark["type"] === "string" ? mark["type"] : null;
}

/** One encoding channel as a line: what it shows, and how. */
function channelLine(channel: string, def: unknown): string {
  if (!Predicate.isObject(def)) return `${channel}: ${JSON.stringify(def)}`;
  const what =
    typeof def["field"] === "string"
      ? def["field"]
      : typeof def["aggregate"] === "string"
        ? def["aggregate"]
        : "value" in def
          ? JSON.stringify(def["value"])
          : JSON.stringify(def);
  const op =
    typeof def["aggregate"] === "string" && typeof def["field"] === "string"
      ? `${def["aggregate"]} of `
      : "";
  const type = typeof def["type"] === "string" ? ` (${def["type"]})` : "";
  return `${channel}: ${op}${what}${type}`;
}

/**
 * What `spec` draws, in lines a text surface shows: its mark and each
 * encoding channel, and the same for each layer or view it composes.
 */
export function describeChartSpec(spec: unknown, depth = 0): readonly string[] {
  if (!Predicate.isObject(spec)) return [];
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  const mark = markName(spec["mark"]);
  if (mark !== null) lines.push(`${indent}- mark: ${mark}`);
  const encoding = spec["encoding"];
  if (Predicate.isObject(encoding))
    for (const [channel, def] of Object.entries(encoding))
      lines.push(`${indent}- ${channelLine(channel, def)}`);
  for (const key of ["layer", "concat", "hconcat", "vconcat"] as const) {
    const parts = spec[key];
    if (!Array.isArray(parts)) continue;
    parts.forEach((part, i) => {
      lines.push(`${indent}- ${key} ${String(i + 1)}:`);
      lines.push(...describeChartSpec(part, depth + 1));
    });
  }
  for (const key of ["facet", "repeat"] as const)
    if (key in spec) {
      lines.push(`${indent}- ${key}: ${JSON.stringify(spec[key])}`);
      lines.push(...describeChartSpec(spec["spec"], depth + 1));
    }
  return lines;
}
