import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { matchCanvas, matchCanvasList } from "@/components/canvas/routes";
import { CanvasListSurface, CanvasSection, CanvasSurface } from "@/components/canvas/surfaces";
import { CANVAS_NAMESPACE, CanvasListView, CanvasView } from "@/components/canvas/views";
import {
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
  provideRoute,
  provideView,
} from "@/lib/plugins";

/** Canvases: the list and one canvas (its own viewport, so `fixed`), their routes, the section. */
export const canvasUiPlugin = definePlugin({
  name: CANVAS_NAMESPACE,
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(
          ViewPoint,
          provideView(CanvasListView, {
            placements: ["page"],
            sample: {},
            Component: CanvasListSurface,
          }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(CanvasView, {
            placements: ["page"],
            sample: { id: "canvas.contract-sample" },
            Component: CanvasSurface,
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: CanvasListView,
            match: matchCanvasList,
            frame: () => "fixed",
            pendingTitle: () => "Opening canvas…",
          }),
        ),
        ctx.contribute(
          RoutePoint,
          provideRoute({
            view: CanvasView,
            match: matchCanvas,
            frame: () => "fixed",
            pendingTitle: () => "Opening canvas…",
          }),
        ),
        ctx.contribute(SidebarSectionPoint, {
          id: "section",
          value: { order: 30, Component: CanvasSection },
        }),
      ],
      { discard: true },
    ),
});
