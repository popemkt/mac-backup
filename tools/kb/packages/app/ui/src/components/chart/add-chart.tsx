/**
 * "Add chart", the chart's node command: on a query node, a chart of its rows
 * (`chart.vega-lite`) started from its columns, named among its views and
 * opened beside the pane.
 */
import { ChartBarIcon } from "@phosphor-icons/react";
import { queryDefOf } from "@kb/model";
import { ChartView, starterChartSpec } from "@kb/views";
import { browserHost, nodeAction, nodePath, queryRecords, toast, type Command } from "@/sdk";

export const addChartCommand: Command = {
  id: "add-chart",
  scope: "node",
  chrome: () => ({ label: "Add chart", icon: <ChartBarIcon size={14} weight="bold" /> }),
  when: (ctx) =>
    queryDefOf(
      ctx.target.nodeId === null ? undefined : ctx.outline.nodes.get(ctx.target.nodeId),
    ) !== null,
  run: (ctx) =>
    nodeAction(ctx, (nodeId) => {
      void (async () => {
        const def = queryDefOf(ctx.outline.nodes.get(nodeId));
        const columns = def === null ? [] : queryRecords(def.edn, []).columns;
        const proposed = await browserHost().proposeView({
          view: ChartView,
          params: { spec: starterChartSpec(columns) },
          host: nodeId,
        });
        if ("refused" in proposed) toast(`Could not add a chart: ${proposed.refused}`);
        else ctx.workspace.openBeside(ctx.workspace.focused, nodePath(nodeId, proposed.id));
      })();
    }),
};
