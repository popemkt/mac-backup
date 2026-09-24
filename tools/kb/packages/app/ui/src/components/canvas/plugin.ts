import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import {
  CANVAS_LIST,
  CANVAS_NAMESPACE,
  CANVAS_PAGE,
  matchCanvas,
  matchCanvasList,
} from "@/components/canvas/routes";
import { CanvasListSurface, CanvasSection, CanvasSurface } from "@/components/canvas/surfaces";
import { SidebarSectionPoint, SurfacePoint } from "@/lib/plugins";

/** Canvases: the list, one canvas (its own viewport, so `fixed`), and the section. */
export const canvasUiPlugin = definePlugin({
  name: CANVAS_NAMESPACE,
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(SurfacePoint, {
          id: CANVAS_LIST,
          value: {
            match: matchCanvasList,
            frame: () => "fixed",
            pendingTitle: () => "Opening canvas…",
            Component: CanvasListSurface,
          },
        }),
        ctx.contribute(SurfacePoint, {
          id: CANVAS_PAGE,
          value: {
            match: matchCanvas,
            frame: () => "fixed",
            pendingTitle: () => "Opening canvas…",
            Component: CanvasSurface,
          },
        }),
        ctx.contribute(SidebarSectionPoint, {
          id: "section",
          value: { order: 30, Component: CanvasSection },
        }),
      ],
      { discard: true },
    ),
});
