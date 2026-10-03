import { lazy } from "react";
import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { CHART_NAMESPACE, ChartView, starterChartSpec } from "@kb/views";
import { BrowserHostService, CommandPoint, ViewPoint, provideView } from "@/sdk";
import { addChartCommand } from "./add-chart";

/**
 * The chart's page, in a chunk of its own; Vega loads in another one inside
 * it, only once there are rows to draw (the lazy-chunk fence).
 */
const ChartPage = lazy(() =>
  import("@/components/chart/chart-page").then((m) => ({ default: m.ChartPage })),
);

/**
 * Charts (roadmap decision 10): the `chart.vega-lite` view, a query node's
 * rows drawn by a Vega-Lite spec, and "Add chart" in a query node's menu. It
 * owns no route: a node opens it through `/node/<id>/<view>` like any view,
 * so a pane, a dashboard and the pane switcher reach it with nothing of its
 * own.
 */
export const chartUiPlugin = definePlugin({
  name: CHART_NAMESPACE,
  inject: [BrowserHostService],
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(
          ViewPoint,
          provideView(ChartView, {
            placements: ["page"],
            sample: { source: "n.root-a", spec: starterChartSpec([]) },
            Component: ChartPage,
          }),
        ),
        ctx.contribute(CommandPoint, { id: addChartCommand.id, value: addChartCommand }),
      ],
      { discard: true },
    ),
});
