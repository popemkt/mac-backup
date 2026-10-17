/**
 * How the canvas tells its scripts it lies (DESIGN-UI.md → Scripts): each
 * item's screen rectangle as the shown projection draws it
 * (`itemScreenRects`, the camera model's), which a script's drawing stands
 * on, and everywhere a press reaches something (`pressRegions`): every item
 * and the chrome its projection draws round it, every edge's line and
 * label, and the 3D gizmo's handles, from the meshes its picking hits —
 * which a script's drawing never lies over. Told again on every render —
 * whenever the page renders, and in 3D on every frame the camera moves,
 * which re-renders only this.
 */
import { useEffect } from "react";
import type { CanvasDoc } from "@kb/canvas";
import type { ViewLayout } from "@kb/ui-sdk";
import type { CanvasView } from "./canvas-camera";
import type { CanvasCameraRig } from "./canvas-camera-rig";
import type { SceneGizmo } from "./canvas-gizmo";
import { canvasProjection } from "./canvas-projections";
import { itemScreenRects, pressRegions } from "./canvas-visible";
import { useShownView } from "./use-shown-view";

export function CanvasScriptLayout({
  rig,
  in3d,
  flatView,
  width,
  height,
  doc,
  selected,
  gizmo,
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
  /** The selected items, whose handles a press reaches too. */
  readonly selected: ReadonlySet<string>;
  /** The scene's gizmo, which stands on the selection in 3D. */
  readonly gizmo: SceneGizmo;
  readonly layout: ViewLayout;
}) {
  const view = useShownView(rig, in3d, flatView);
  // Read on every render: the camera, the page (the selection, the gizmo's mode) and the scene each move it.
  const size = { width, height };
  const shown = canvasProjection(in3d ? "3d" : "2d");
  const own = in3d ? [gizmo.reach()].filter((reach) => reach !== null) : [];
  const told = {
    anchors: Object.fromEntries(itemScreenRects(doc.nodes, view, size)),
    interactive: pressRegions(doc, view, size, { chrome: shown.chrome, selected, own }),
  };
  useEffect(() => layout.set(told));
  return null;
}
