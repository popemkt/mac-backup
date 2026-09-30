import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { VIEW_VALUES } from "@kb/model";
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
  NeighbourhoodView,
  TreeView,
  TreemapView,
} from "@/components/graph/views";
import { NeighbourhoodGraph } from "@/components/graph/neighbourhood-view";
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
 * its section, one view per renderer — each drawn in the box the page's
 * canvas gives it, from the settings its key declares, and offered by the
 * renderer switch in its picker's order — and a node's neighbourhood, which
 * hosts a renderer in a box of its own.
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
            picker: { label: VIEW_VALUES["graph.force2d"].label, order: 0 },
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
            picker: { label: VIEW_VALUES["graph.tree"].label, order: 1 },
            sample: { showLabels: DEFAULT_SHOW_LABELS },
            Component: TreeRendererView,
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(ClusterView, {
            placements: ["page"],
            picker: { label: VIEW_VALUES["graph.cluster"].label, order: 2 },
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
            picker: { label: VIEW_VALUES["graph.force3d"].label, order: 3 },
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
            picker: { label: VIEW_VALUES["graph.treemap"].label, order: 4 },
            sample: { showLabels: DEFAULT_SHOW_LABELS },
            Component: TreemapRendererView,
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(NeighbourhoodView, {
            placements: ["page", "inline"],
            sample: {
              root: "n.root-a",
              hops: 1,
              edges: ["mention", "child"],
              renderer: Force2dView.option,
              settings: {
                layout: DEFAULT_LAYOUT,
                spread: DEFAULT_SPREAD,
                linkDistance: DEFAULT_LINK_DISTANCE,
                showLabels: DEFAULT_SHOW_LABELS,
                autorotate: DEFAULT_AUTOROTATE,
                labelDensity: DEFAULT_LABEL_DENSITY,
                theme: DEFAULT_THEME,
                linkStyle: DEFAULT_LINK_STYLE,
              },
            },
            Component: NeighbourhoodGraph,
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
