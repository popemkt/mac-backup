import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { matchGraph } from "@/components/graph/routes";
import { GraphSection, GraphSurface } from "@/components/graph/surfaces";
import { GRAPH_NAMESPACE, GraphView } from "@/components/graph/views";
import {
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
  provideRoute,
  provideView,
} from "@/lib/plugins";

/** The graph: its view, the route to it (whole column, no workspace header), and its section. */
export const graphUiPlugin = definePlugin({
  name: GRAPH_NAMESPACE,
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(
          ViewPoint,
          provideView(GraphView, { placements: ["page"], Component: GraphSurface }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: GraphView,
            match: matchGraph,
            frame: () => "full",
            pendingTitle: () => "Opening graph…",
          }),
        ),
        ctx.contribute(SidebarSectionPoint, {
          id: "section",
          value: { order: 10, Component: GraphSection },
        }),
      ],
      { discard: true },
    ),
});
