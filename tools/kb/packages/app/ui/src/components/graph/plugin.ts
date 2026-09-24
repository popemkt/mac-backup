import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { GRAPH_NAMESPACE, GRAPH_PAGE, matchGraph } from "@/components/graph/routes";
import { GraphSection, GraphSurface } from "@/components/graph/surfaces";
import { SidebarSectionPoint, SurfacePoint } from "@/lib/plugins";

/** The graph: its page (whole column, no workspace header) and its sidebar section. */
export const graphUiPlugin = definePlugin({
  name: GRAPH_NAMESPACE,
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(SurfacePoint, {
          id: GRAPH_PAGE,
          value: {
            match: matchGraph,
            frame: () => "full",
            pendingTitle: () => "Opening graph…",
            Component: GraphSurface,
          },
        }),
        ctx.contribute(SidebarSectionPoint, {
          id: "section",
          value: { order: 10, Component: GraphSection },
        }),
      ],
      { discard: true },
    ),
});
