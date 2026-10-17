import { useSyncExternalStore } from "react";
import type { CanvasView } from "./canvas-camera";
import type { CanvasCameraRig } from "./canvas-camera-rig";

/**
 * The view the showing projection draws with, kept current: in 3D the rig's,
 * on every frame it moves; in 2D the page's flat camera. What is drawn over
 * either projection from the camera model reads it here.
 */
export function useShownView(
  rig: CanvasCameraRig,
  in3d: boolean,
  flatView: CanvasView,
): CanvasView {
  const live = useSyncExternalStore(rig.subscribe, () => rig.view);
  return in3d ? live : flatView;
}
