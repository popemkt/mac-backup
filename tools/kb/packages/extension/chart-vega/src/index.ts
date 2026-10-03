/**
 * How kb runs Vega, the chart family's painter: one place, so the browser
 * that draws a chart view and the server that paints its snapshot run a spec
 * the same way. It is also the family's server entry, which hands this
 * painter to the shared plugin (DESIGN.md → Extension families → a painter
 * belongs to the view that paints with it).
 *
 * - A Vega-Lite spec compiles to Vega, which parses to an AST (`ast: true`)
 *   that `vega-interpreter` evaluates: no expression is ever compiled with
 *   `new Function`, so a stored spec runs no code and a strict CSP holds.
 * - The loader fetches nothing. A chart's data is its query's rows, inline;
 *   a URL that slipped past the spec's check, an image or a link resolves
 *   to nothing rather than to the network.
 *
 * DESIGN.md → View nodes → Chart views states the model; DESIGN-UI.md →
 * Chart views the renderer.
 */
import { Effect } from "effect";
import { View, parse, type Loader, type TooltipHandler, type ViewOptions } from "vega";
import { compile, type TopLevelSpec } from "vega-lite";
import { expressionInterpreter } from "vega-interpreter";
import { chartPlugin, type ChartPainter } from "@kb/chart";
import { domainError } from "@kb/model";
import type { Plugin } from "@kb/plugin";

const refuse = (uri: string): Promise<never> =>
  Promise.reject(new Error(`a chart fetches nothing: ${uri}`));

/** The loader every kb chart runs with: nothing is loaded, sanitized into a link or fetched. */
export const NO_NETWORK: Loader = {
  load: refuse,
  sanitize: refuse,
  http: refuse,
  file: refuse,
};

/** What a chart view draws with beyond its spec. */
export interface ChartViewOptions {
  /** Vega-Lite config merged under the spec's own (`spec.config` wins): the theme. */
  readonly config?: Readonly<Record<string, unknown>>;
  /** The element it draws into; none draws headless. */
  readonly container?: ViewOptions["container"];
  readonly renderer?: "svg" | "canvas" | "none";
  readonly tooltip?: TooltipHandler;
}

/**
 * A Vega view of the Vega-Lite `spec` (its data inline), compiled and parsed
 * the CSP-safe way and running with {@link NO_NETWORK}. The caller runs it
 * (`runAsync`) and finalizes it.
 */
export function chartView(
  spec: Readonly<Record<string, unknown>>,
  options: ChartViewOptions = {},
): View {
  const vega = compile(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON the chart key's ChartSpec already checked; Vega-Lite's TS types are its schema, which kb does not restate
    spec as unknown as TopLevelSpec,
    options.config === undefined ? {} : { config: options.config },
  ).spec;
  return new View(parse(vega, undefined, { ast: true }), {
    expr: expressionInterpreter,
    loader: NO_NETWORK,
    renderer: options.renderer ?? "none",
    hover: options.container !== undefined,
    ...(options.container === undefined ? {} : { container: options.container }),
    ...(options.tooltip === undefined ? {} : { tooltip: options.tooltip }),
  });
}

/** The Vega-Lite `spec` as one SVG document, drawn headless: no canvas, no DOM. */
export const chartSvg = Effect.fn("vega.chartSvg")(function* (
  spec: Readonly<Record<string, unknown>>,
) {
  return yield* Effect.acquireUseRelease(
    Effect.try({
      try: () => chartView(spec),
      catch: (err) =>
        domainError("invalid_input", `the chart cannot be compiled: ${messageOf(err)}`),
    }),
    (view) =>
      Effect.tryPromise({
        try: () => view.toSVG(),
        catch: (err) => domainError("internal", `the chart cannot be drawn: ${messageOf(err)}`),
      }),
    (view) => Effect.sync(() => view.finalize()),
  );
});

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The chart's painter where no browser draws: Vega, headless. */
export const vegaChartPainter: ChartPainter = { svg: chartSvg };

/** The chart family's server entry: its shared plugin, painting each chart page's figure with Vega. */
export const chartServerPlugin: Plugin = chartPlugin({ painter: vegaChartPainter });
