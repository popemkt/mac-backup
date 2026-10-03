/**
 * The chart family's shared package (DESIGN.md → Extension families): its
 * ids, its view key and the spec it reads, the rows a chart draws, how a
 * chart says itself in text, and the declaration and shared plugin both
 * hosts build their entries from. The painter is `@kb/chart-vega`'s.
 */
export { CHART_IDS } from "./ids.ts";
export { MAX_CHART_ROWS, chartRecords } from "./records.ts";
export type { ChartPainter } from "./text.ts";
export {
  CHART_DATA,
  CHART_MARKS,
  ChartParams,
  ChartSpec,
  ChartView,
  chartSpecWithData,
  describeChartSpec,
  fillsChartBox,
  starterChartSpec,
  type ChartBox,
} from "./view.ts";
export { chartExtension, chartPlugin, type ChartPluginOptions } from "./extension.ts";
