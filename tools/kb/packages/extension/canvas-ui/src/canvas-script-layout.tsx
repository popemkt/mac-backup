/**
 * How the canvas tells its scripts it lies (DESIGN-UI.md → Scripts): each
 * item's screen rectangle as the shown projection draws it
 * (`itemScreenRects`, the camera model's), which a script's drawing stands
 * on, and where the canvas takes gestures — every item's rectangle and every
 * edge's line (`edgeScreenLines`) — which a script's drawing never lies
 * over. Told again whenever the view, the stage or the document moves: in
 * 3D on every frame the camera moves, which re-renders only this.
 */
import { useEffect } from "react";
import type { CanvasDoc } from "@kb/canvas";
import type { ScreenRegion, ViewLayout } from "@kb/ui-sdk";
import type { CanvasView } from "./canvas-camera";
import type { CanvasCameraRig } from "./canvas-camera-rig";
import { EDGE_REACH, edgeScreenLines, itemScreenRects } from "./canvas-visible";
import { useShownView } from "./use-shown-view";

export function CanvasScriptLayout({
  rig,
  in3d,
  flatView,
  width,
  height,
  doc,
  layout,
}: {
  readonly rig: CanvasCameraRig;
  /** The 3D scene is the one showing (otherwise the view is `flatView`). */
  readonly in3d: boolean;
  readonly flatView: CanvasView;
  /** The stage's size, which the scripts' frames cover. */
  readonly width: number;
  readonly height: number;
  readonly doc: CanvasDoc;
  readonly layout: ViewLayout;
}) {
  const view = useShownView(rig, in3d, flatView);
  useEffect(() => {
    const size = { width, height };
    const rects = itemScreenRects(doc.nodes, view, size);
    const interactive: ScreenRegion[] = [
      ...[...rects.values()].map((box) => ({ box })),
      ...edgeScreenLines(doc, view, size).map(({ points }) => ({
        line: points,
        width: EDGE_REACH,
      })),
    ];
    layout.set({ anchors: Object.fromEntries(rects), interactive });
  }, [layout, doc, view, width, height]);
  return null;
}
