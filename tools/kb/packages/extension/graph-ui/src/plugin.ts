import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { matchGraph } from "./routes";
import {
  ClusterRendererView,
  Force2dRendererView,
  Force3dRendererView,
  GraphSection,
  GraphSurface,
  TreeRendererView,
  TreemapRendererView,
} from "./surfaces";
import {
  DEFAULT_AUTOROTATE,
  DEFAULT_EDGE_LABELS,
  DEFAULT_LABEL_DENSITY,
  DEFAULT_LAYOUT,
  DEFAULT_LINK_DISTANCE,
  DEFAULT_LINK_STYLE,
  DEFAULT_SHOW_LABELS,
  DEFAULT_SPREAD,
  DEFAULT_THEME,
  ClusterView,
  Force2dView,
  Force3dView,
  GraphView,
  graphExtension,
  graphPlugin,
  NeighbourhoodView,
  TreeView,
  TreemapView,
} from "@kb/graph";
import { NeighbourhoodGraph } from "./neighbourhood-view";
import { graphThemesPlugin } from "./graph-themes";
import { lensGraphs } from "./graph-lens";
import { TYPE_REFERENCE_COMMAND, TYPE_REFERENCE_STEP } from "./type-reference";
import {
  BrowserHostService,
  CommandPoint,
  NodeLinkGraphService,
  PaletteStepPoint,
  provideRoute,
  provideView,
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
} from "@kb/ui-sdk";

/**
 * The graph: its page, the route to it (whole column, no workspace header),
 * its section, one view per renderer — each drawn in the box the page's
 * canvas gives it, from the settings its key declares, and offered by the
 * renderer switch in its picker's order — and a node's neighbourhood, which
 * hosts a renderer in a box of its own. It injects the page's host, as a
 * family's browser half does, and waits as pending until the shell provides it.
 * It provides the lens graph of a perspective (`NodeLinkGraphService`) for the
 * halves that draw the graph without being it, and the node menu's "Type this
 * reference…" with the palette step it opens (`type-reference.tsx`).
 *
 * It loads the family's own graph themes (`graphThemesPlugin`), contributed
 * to its theme point under the keys its declaration lists.
 *
 * It is the graph family's page entry, so it loads the family's shared
 * plugin as a child: the graph views' keys reach the page kernel's catalog
 * from the family, as the server's do.
 */
export const graphUiPlugin = definePlugin({
  name: graphExtension.name,
  inject: [BrowserHostService],
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(graphPlugin()),
        ctx.plugin(graphThemesPlugin),
        ctx.provide(NodeLinkGraphService, lensGraphs),
        ctx.contribute(CommandPoint, TYPE_REFERENCE_COMMAND),
        ctx.contribute(PaletteStepPoint, TYPE_REFERENCE_STEP),
        ctx.contribute(
          ViewPoint,
          provideView(GraphView, { placements: ["page"], sample: {}, Component: GraphSurface }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(Force2dView, {
            placements: ["page"],
            picker: { order: 0 },
            sample: {
              layout: DEFAULT_LAYOUT,
              labelDensity: DEFAULT_LABEL_DENSITY,
              showLabels: DEFAULT_SHOW_LABELS,
              edgeLabels: DEFAULT_EDGE_LABELS,
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
            picker: { order: 1 },
            sample: { showLabels: DEFAULT_SHOW_LABELS },
            Component: TreeRendererView,
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(ClusterView, {
            placements: ["page"],
            picker: { order: 2 },
            sample: {
              labelDensity: DEFAULT_LABEL_DENSITY,
              showLabels: DEFAULT_SHOW_LABELS,
              edgeLabels: DEFAULT_EDGE_LABELS,
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
            picker: { order: 3 },
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
            picker: { order: 4 },
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
                edgeLabels: DEFAULT_EDGE_LABELS,
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
            entry: "/graph",
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
