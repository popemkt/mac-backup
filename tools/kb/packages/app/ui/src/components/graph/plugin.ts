import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { matchGraph } from "@/components/graph/routes";
import {
  ClusterRendererView,
  Force2dRendererView,
  Force3dRendererView,
  GraphSection,
  GraphSurface,
  TreeRendererView,
  TreemapRendererView,
} from "@/components/graph/surfaces";
import {
  ClusterView,
  Force2dView,
  Force3dView,
  GRAPH_NAMESPACE,
  GraphView,
  TreeView,
  TreemapView,
} from "@/components/graph/views";
import {
  DEFAULT_AUTOROTATE,
  DEFAULT_LABEL_DENSITY,
  DEFAULT_LAYOUT,
  DEFAULT_LINK_DISTANCE,
  DEFAULT_LINK_STYLE,
  DEFAULT_SHOW_LABELS,
  DEFAULT_SPREAD,
  DEFAULT_THEME,
} from "@/lib/graph-lens";
import {
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
  provideRoute,
  provideView,
} from "@/lib/plugins";

/**
 * The graph: its page, the route to it (whole column, no workspace header),
 * its section, and one view per renderer — each drawn in the box the page's
 * canvas gives it, from the settings its key declares.
 */
export const graphUiPlugin = definePlugin({
  name: GRAPH_NAMESPACE,
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(
          ViewPoint,
          provideView(GraphView, { placements: ["page"], sample: {}, Component: GraphSurface }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(Force2dView, {
            placements: ["page"],
            sample: {
              layout: DEFAULT_LAYOUT,
              labelDensity: DEFAULT_LABEL_DENSITY,
              showLabels: DEFAULT_SHOW_LABELS,
              theme: DEFAULT_THEME,
              linkStyle: DEFAULT_LINK_STYLE,
            },
            Component: Force2dRendererView,
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(TreeView, {
            placements: ["page"],
            sample: { showLabels: DEFAULT_SHOW_LABELS },
            Component: TreeRendererView,
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(ClusterView, {
            placements: ["page"],
            sample: {
              labelDensity: DEFAULT_LABEL_DENSITY,
              showLabels: DEFAULT_SHOW_LABELS,
              theme: DEFAULT_THEME,
              linkStyle: DEFAULT_LINK_STYLE,
            },
            Component: ClusterRendererView,
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(Force3dView, {
            placements: ["page"],
            sample: {
              spread: DEFAULT_SPREAD,
              linkDistance: DEFAULT_LINK_DISTANCE,
              labelDensity: DEFAULT_LABEL_DENSITY,
              showLabels: DEFAULT_SHOW_LABELS,
              autorotate: DEFAULT_AUTOROTATE,
              theme: DEFAULT_THEME,
              linkStyle: DEFAULT_LINK_STYLE,
            },
            Component: Force3dRendererView,
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(TreemapView, {
            placements: ["page"],
            sample: { showLabels: DEFAULT_SHOW_LABELS },
            Component: TreemapRendererView,
          }),
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
