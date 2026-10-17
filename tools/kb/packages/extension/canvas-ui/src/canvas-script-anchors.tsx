/**
 * Where the canvas tells its scripts its items are (DESIGN-UI.md → Scripts):
 * each item's screen rectangle as the shown projection draws it
 * (`itemScreenRects`, the camera model's), told again whenever the view,
 * the stage or the items move — in 3D on every frame the camera moves, which
 * re-renders only this.
 */
import { useEffect } from "react";
import type { CanvasNode } from "@kb/canvas";
import type { ViewLayout } from "@kb/ui-sdk";
import type { CanvasView } from "./canvas-camera";
import type { CanvasCameraRig } from "./canvas-camera-rig";
import { itemScreenRects } from "./canvas-visible";
import { useShownView } from "./use-shown-view";

export function CanvasScriptAnchors({
  rig,
  in3d,
  flatView,
  width,
  height,
  items,
  layout,
}: {
  readonly rig: CanvasCameraRig;
  /** The 3D scene is the one showing (otherwise the view is `flatView`). */
  readonly in3d: boolean;
  readonly flatView: CanvasView;
  /** The stage's size, which the scripts' frames cover. */
  readonly width: number;
  readonly height: number;
  readonly items: readonly CanvasNode[];
  readonly layout: ViewLayout;
}) {
  const view = useShownView(rig, in3d, flatView);
  useEffect(() => {
    layout.set({ anchors: Object.fromEntries(itemScreenRects(items, view, { width, height })) });
  }, [layout, items, view, width, height]);
  return null;
}
