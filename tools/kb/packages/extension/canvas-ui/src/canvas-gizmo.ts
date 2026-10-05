/**
 * The 3D transform gizmo's vocabulary (plan 2026-10-02, decision 10), with
 * no three in it: which transform the gizmo shows, in which space, and the
 * port the scene's gestures drive it through. The gizmo itself is the scene's
 * (`canvas-scene-gizmo`, three's `TransformControls`); what it makes is a
 * `CanvasTransform`, which the pointer reducer previews and writes like any
 * other handle's.
 */
import type { CanvasTransform } from "@kb/canvas";
import type { CanvasPoint } from "./canvas-camera";

/** What the gizmo's handles do: move, rotate or scale the selection. */
export type GizmoMode = "move" | "rotate" | "scale";

/** Which axes the handles run along: the canvas's own, or the selection's (the first item's). */
type GizmoSpace = "global" | "local";

export interface GizmoChoice {
  readonly mode: GizmoMode;
  readonly space: GizmoSpace;
}

/** The gizmo a canvas first shows: move, along the canvas's axes (Blender's default). */
export const FIRST_GIZMO: GizmoChoice = { mode: "move", space: "global" };

/** Each mode's name on the selection toolbar, in its order. */
export const GIZMO_MODES: readonly { readonly mode: GizmoMode; readonly label: string }[] = [
  { mode: "move", label: "Move" },
  { mode: "rotate", label: "Rotate" },
  { mode: "scale", label: "Scale" },
];

/**
 * The gizmo as the scene's gestures drive it, by viewport points (CSS pixels
 * from the stage's top left). The scene hit-tests its handles with the camera
 * model's own ray (`screenRay`).
 */
export interface SceneGizmo {
  /** Whether a handle is under `local` (and lights it). */
  hover(local: CanvasPoint): boolean;
  /** Take hold of the handle under `local`; false when there is none. */
  press(local: CanvasPoint): boolean;
  /** The transform the handle held makes with the pointer at `local`; null before it has one. */
  drag(local: CanvasPoint): CanvasTransform | null;
  /** Let go of the handle. */
  release(): void;
}

/**
 * Each canvas axis's colour, X red, Y green, Z blue, as every 3D tool draws
 * them: the view widget's ends and a modal transform's guide lines.
 */
export const AXIS_INK: { readonly [A in "x" | "y" | "z"]: string } = {
  x: "var(--axis-x)",
  y: "var(--axis-y)",
  z: "var(--axis-z)",
};

/** A gizmo with no handles: before the scene is up, and wherever nothing is selected. */
export const NO_GIZMO: SceneGizmo = {
  hover: () => false,
  press: () => false,
  drag: () => null,
  release: () => {},
};
