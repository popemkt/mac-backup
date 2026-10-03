/**
 * The canvas projections: the ways one canvas document is drawn, each the
 * one camera model (`lib/canvas-camera`) held a particular way
 * (DESIGN-UI.md → Canvas → Projections).
 *
 * - **2D** is the camera from the top and orthographic, drawn as DOM cards
 *   over SVG edges (`canvas-stage`).
 * - **3D** is the camera on its turntable about the floor's z, through a
 *   perspective or an orthographic lens, drawn on the scene kit
 *   (`canvas-scene`).
 *
 * Every projection draws every item and every edge, hit-tests through
 * `hitTest`, moves cards on their own plane and marks the shared selection;
 * `canvas-projection.contract.test.tsx` proves that over each entry here. A
 * projection declares only what differs: how it holds the camera, and the
 * view it opens at when it takes over from another.
 */
import type { CanvasPose, CanvasProjectionKind } from "@kb/canvas";
import {
  PERSPECTIVE_FOV,
  heldOrbit,
  lensOf,
  presetView,
  viewOfPose,
  withLens,
  type CanvasView,
} from "@/lib/canvas-camera";

export interface CanvasProjection {
  readonly kind: CanvasProjectionKind;
  /** The toolbar's name for it. */
  readonly label: string;
  readonly title: string;
  /** The one camera as this projection holds it. */
  readonly settle: (view: CanvasView) => CanvasView;
  /**
   * The view it opens at, taking over from `from`: its saved pose when the
   * canvas has one, otherwise the same focus and zoom held its own way.
   */
  readonly arrive: (from: CanvasView, saved: CanvasPose | undefined) => CanvasView;
}

const flat = (view: CanvasView): CanvasView => ({ ...view, yaw: 0, pitch: 0, fov: 0 });

/** The turntable within its range, through whichever of the two lenses it is nearer. */
const turntable = (view: CanvasView): CanvasView => withLens(heldOrbit(view), lensOf(view));

const BY_KIND: { readonly [K in CanvasProjectionKind]: CanvasProjection & { readonly kind: K } } = {
  "2d": {
    kind: "2d",
    label: "2D",
    title: "Flat: the top view, cards edited in place",
    settle: flat,
    arrive: (from) => flat(from),
  },
  "3d": {
    kind: "3d",
    label: "3D",
    title: "Depth: drag to orbit the floor, Alt-drag a card to lift it",
    settle: turntable,
    // A first visit opens oblique and in perspective, a little further back.
    arrive: (from, saved) =>
      turntable(
        saved === undefined
          ? { ...presetView(from, "oblique"), zoom: from.zoom * 0.92, fov: PERSPECTIVE_FOV }
          : viewOfPose(saved, PERSPECTIVE_FOV),
      ),
  },
};

/** Every projection, in the toolbar's order. */
export const CANVAS_PROJECTIONS: readonly CanvasProjection[] = [BY_KIND["2d"], BY_KIND["3d"]];

export function canvasProjection(kind: CanvasProjectionKind): CanvasProjection {
  return BY_KIND[kind];
}
