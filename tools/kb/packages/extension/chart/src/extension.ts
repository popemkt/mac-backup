/**
 * The chart family's declaration and its shared plugin (DESIGN.md →
 * Extension families). The declaration is the one home of the family's
 * name, seed and views; the bundled seed folds it, and both hosts' entries
 * are built from {@link chartPlugin}, so the key, the seed and the text body
 * cannot differ between them. Only the painter does: the server's entry
 * (`@kb/chart-vega`) hands it Vega, and the page's hands it none.
 */
import { declarationPlugin, defineExtension, viewDef, type ViewDef } from "@kb/contracts";
import type { Plugin } from "@kb/plugin";
import { chartSeedNodes } from "./seed.ts";
import { chartText, type ChartPainter } from "./text.ts";
import { ChartView } from "./view.ts";

/** The family's views, their text drawing a page figure with `painter` when there is one. */
function chartViews(painter: ChartPainter | null): readonly ViewDef<unknown>[] {
  return [viewDef(ChartView, chartText(painter))];
}

export const chartExtension = defineExtension({
  name: "chart",
  label: "Chart",
  seed: chartSeedNodes,
  views: chartViews(null),
});

export interface ChartPluginOptions {
  /** What paints a chart's page figure on this host; none draws its text alone. */
  readonly painter?: ChartPainter;
}

/**
 * The chart family's shared plugin: its declaration's views, with the text
 * drawing a figure through the host's painter. Each host's entry is a call
 * to it, as the server's entry or as a child of the page's.
 */
export function chartPlugin({ painter }: ChartPluginOptions = {}): Plugin {
  return declarationPlugin({ ...chartExtension, views: chartViews(painter ?? null) });
}
