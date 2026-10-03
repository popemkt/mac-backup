/**
 * The chart family's system ids (DESIGN.md → Extension families → ids are
 * frozen data). They kept their spelling when they left core's table, so a
 * store seeded before the move opens without a write.
 */
export const CHART_IDS = {
  /**
   * A chart view's Vega-Lite spec, as canonical JSON (text, single).
   * DESIGN.md → View nodes → Chart views.
   */
  chartField: "sys.f.chart",
} as const;
