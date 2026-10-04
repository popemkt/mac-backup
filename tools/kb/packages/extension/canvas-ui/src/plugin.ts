import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { matchCanvas, matchCanvasList } from "./routes";
import { CanvasListSurface, CanvasSection, CanvasSurface } from "./surfaces";
import { CanvasListView, CanvasView, canvasExtension, canvasPlugin } from "@kb/canvas";
import {
  BrowserHostService,
  provideRoute,
  provideView,
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
} from "@kb/ui-sdk";

/**
 * Canvases: the list and one canvas (its own viewport, so `fixed`), their
 * routes, the section.
 *
 * It is the canvas family's page entry, so it loads the family's shared
 * plugin as a child: the canvas views' keys reach the page kernel's catalog
 * from the family, as the server's do.
 */
export const canvasUiPlugin = definePlugin({
  name: canvasExtension.name,
  inject: [BrowserHostService],
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(canvasPlugin()),
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
