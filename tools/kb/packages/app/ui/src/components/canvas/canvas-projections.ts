/**
 * The canvas projections: the ways one canvas document is drawn, each the
 * one camera model (`lib/canvas-camera`) held a particular way
 * (DESIGN-UI.md → Canvas → Projections).
 *
 * - **2D** is the camera face-on and orthographic, drawn as DOM cards over
 *   SVG edges (`canvas-stage`).
 * - **3D** is the camera in perspective, orbiting its focus, drawn on the
 *   scene kit (`canvas-scene`).
 *
 * Every projection draws every item and every edge, hit-tests through
 * `hitTest`, moves cards on their own plane and marks the shared selection;
 * `canvas-projection.contract.test.tsx` proves that over each entry here. A
 * projection declares only what differs: how it holds the camera, and the
 * view it opens at when it takes over from another.
 */
import type { CanvasPose, CanvasProjectionKind } from "@kb/canvas";
import { MAX_PITCH, viewOfPose, type CanvasView } from "@/lib/canvas-camera";

/** The 3D field of view, degrees: long enough that cards stay square-on readable. */
const PERSPECTIVE_FOV = 34;

/** The orbit a canvas first opens at in 3D: tipped back like a desk, turned a little. */
const FIRST_ORBIT = { yaw: -0.2, pitch: 0.58 } as const;

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

const perspective = (view: CanvasView): CanvasView => ({
  ...view,
  pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, view.pitch)),
  fov: PERSPECTIVE_FOV,
});

const BY_KIND: { readonly [K in CanvasProjectionKind]: CanvasProjection & { readonly kind: K } } = {
  "2d": {
    kind: "2d",
    label: "2D",
    title: "Flat: edit cards in place",
    settle: flat,
    arrive: (from) => flat(from),
  },
  "3d": {
    kind: "3d",
    label: "3D",
    title: "Depth: drag to orbit, Alt-drag a card to lift it",
    settle: perspective,
    arrive: (from, saved) =>
      perspective(
        saved === undefined
          ? { ...from, ...FIRST_ORBIT, zoom: from.zoom * 0.92 }
          : viewOfPose(saved, PERSPECTIVE_FOV),
      ),
  },
};

/** Every projection, in the toolbar's order. */
export const CANVAS_PROJECTIONS: readonly CanvasProjection[] = [BY_KIND["2d"], BY_KIND["3d"]];

export function canvasProjection(kind: CanvasProjectionKind): CanvasProjection {
  return BY_KIND[kind];
}
