import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { LAYOUT_NAMESPACE, LayoutView, NodeView } from "@kb/views";
import { provideRoute, provideView, RoutePoint, ViewPoint } from "@kb/ui-sdk";
import { LayoutViewSurface } from "./layout-view";
import { NodeViewSurface } from "./node-view";
import { matchNode } from "./routes";

/**
 * Layouts and the node route: the layout view (`layout.grid`, a dashboard
 * when shown inside a pane) and `/node/<id>[/<view>]`, the one route a node
 * is opened by. The workspace's own panes are the shell's
 * (`components/layout/workspace`), drawn with the same grid.
 */
export const layoutUiPlugin = definePlugin({
  name: LAYOUT_NAMESPACE,
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(
          ViewPoint,
          provideView(LayoutView, {
            placements: ["page"],
            sample: { root: { tabs: [{ id: "a", path: "/" }] } },
            Component: LayoutViewSurface,
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(NodeView, {
            placements: ["page"],
            sample: { node: "n.root-a" },
            Component: NodeViewSurface,
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: NodeView,
            match: matchNode,
            // The page it resolves to frames itself (NodeViewSurface).
            frame: () => "fixed",
            pendingTitle: () => "Opening…",
          }),
        ),
      ],
      { discard: true },
    ),
});
