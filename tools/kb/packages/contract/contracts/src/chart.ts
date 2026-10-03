import { Context, type Effect } from "effect";
import type { DomainError } from "@kb/model";

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

/**
 * The painter a runtime provides. A surface that provides none draws a chart
 * as its text only — the encoding and the data table — so nothing downstream
 * gains a requirement.
 */
export const ChartSvg = Context.Reference<ChartPainter | null>("kb/ChartSvg", {
  defaultValue: () => null,
});
