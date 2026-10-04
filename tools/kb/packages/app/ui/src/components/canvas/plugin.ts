import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { matchCanvas, matchCanvasList } from "./routes";
import { CanvasListSurface, CanvasSection, CanvasSurface } from "./surfaces";
import { CANVAS_NAMESPACE, CanvasListView, CanvasView } from "@kb/views";
import {
  BrowserHostService,
  provideRoute,
  provideView,
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
} from "@kb/ui-sdk";

/** Canvases: the list and one canvas (its own viewport, so `fixed`), their routes, the section. */
export const canvasUiPlugin = definePlugin({
  name: CANVAS_NAMESPACE,
  inject: [BrowserHostService],
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
            entry: "/canvas",
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
