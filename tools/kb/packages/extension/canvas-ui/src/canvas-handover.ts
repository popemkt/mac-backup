/**
 * The handover between canvas projections: which one owns the viewport, and
 * how the camera travels when that changes (DESIGN-UI.md → Canvas →
 * Projections). React reads it as an external store; nothing here knows
 * React or three.
 *
 * The document's camera names the projection a canvas opens in (`want`);
 * `shown` is the one drawing. They differ only while one hands over:
 *
 * - **into 3D**: the rig stands where the 2D view is (from the top, orthographic)
 *   and a fresh scene mounts behind the DOM canvas (`entering`). Once it
 *   draws (`ready`), the two crossfade — identical at that instant — and
 *   then the rig flies out to the 3D pose: the field of view opens at a
 *   fixed zoom, a dolly zoom;
 * - **back to 2D**: the rig flies back to the top view, orthographic
 *   (`leaving`); on arrival the DOM canvas takes the view's pan and zoom and
 *   fades in over the scene, which stays mounted until the fade is done
 *   (`lingering`).
 *
 * Turning back halfway flies the other way from wherever the camera is.
 * Under reduced motion the rig lands at once and the fades are cut by the
 * global motion rule. A scene that cannot start leaves the canvas in 2D for
 * this visit, without rewriting the document.
 */
import type { CanvasPose, CanvasProjectionKind } from "@kb/canvas";
import { panOfView, viewOfPan, type CanvasPoint, type ViewSize } from "./canvas-camera";
import type { CanvasCameraRig } from "./canvas-camera-rig";
import type { Timing } from "@kb/ui-sdk";
import { canvasProjection } from "./canvas-projections";

type Phase = "entering" | "leaving" | "lingering" | null;

export interface HandoverState {
  readonly shown: CanvasProjectionKind;
  readonly phase: Phase;
  /** Each entry into 3D mounts its own scene. */
  readonly entry: number;
  /** The scene could not start; 2D for the rest of this visit. */
  readonly failed: boolean;
}

/** What the handover reads from the canvas when it acts, and hands back to it. */
export interface HandoverCanvas {
  /** The 2D view's pan and zoom, and the viewport's size. */
  readonly flat: () => { readonly pan: CanvasPoint; readonly zoom: number };
  readonly size: () => ViewSize;
  /** The pose the canvas was last looked at from in 3D, if any. */
  readonly pose: () => CanvasPose | undefined;
  /** The DOM canvas takes this pan and zoom. */
  readonly face: (pan: CanvasPoint, zoom: number) => void;
  /** A flight into 3D arrived: its zoom is the canvas's now. */
  readonly arrived: (zoom: number) => void;
}

export class CanvasHandover {
  private state: HandoverState = { shown: "2d", phase: null, entry: 0, failed: false };
  private readonly listeners = new Set<() => void>();
  private linger: ReturnType<typeof setTimeout> | null = null;
  private readonly rig: CanvasCameraRig;
  private readonly timing: Timing;
  /** The canvas as of its last commit (`bind`). */
  private canvas: HandoverCanvas;

  constructor(rig: CanvasCameraRig, timing: Timing, canvas: HandoverCanvas) {
    this.rig = rig;
    this.timing = timing;
    this.canvas = canvas;
  }

  /** Read the canvas through `canvas` from now on (the page, as it last committed). */
  bind(canvas: HandoverCanvas): void {
    this.canvas = canvas;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = (): HandoverState => this.state;

  /** The projection the document asks for; the handover moves toward it. */
  want(target: CanvasProjectionKind): void {
    const { shown, phase } = this.state;
    const kind = this.state.failed ? "2d" : target;
    if (kind === "3d" && shown === "2d" && phase !== "entering") {
      const { pan, zoom } = this.canvas.flat();
      this.rig.jump(viewOfPan(pan, zoom, this.canvas.size()));
      this.set({ phase: "entering", entry: this.state.entry + 1 });
    } else if (kind === "2d" && phase === "entering") {
      this.set({ phase: null });
    } else if (kind === "2d" && shown === "3d" && phase !== "leaving") {
      this.set({ phase: "leaving" });
      this.rig.flyTo(canvasProjection("2d").arrive(this.rig.view, undefined), () => {
        const face = panOfView(this.rig.view, this.canvas.size());
        this.canvas.face(face.pan, face.zoom);
        this.set({ shown: "2d", phase: "lingering" });
        this.linger = setTimeout(() => this.set({ phase: null }), this.timing.reveal * 1000 + 60);
      });
    } else if (kind === "3d" && shown === "3d" && phase === "leaving") {
      this.flyIn(0);
      this.set({ phase: null });
    }
  }

  /** The scene is drawing: crossfade to it, then fly out to depth. */
  ready(target: CanvasProjectionKind): void {
    if (target !== "3d" || this.state.phase !== "entering") return;
    this.set({ shown: "3d", phase: null });
    // The crossfade runs between two identical pictures; the dolly starts once it is done.
    this.flyIn(this.timing.reveal);
  }

  fail(): void {
    this.set({ failed: true, phase: null, shown: "2d" });
  }

  /** Try depth again after a failure (the toolbar asked for it). */
  retry(): void {
    if (this.state.failed) this.set({ failed: false });
  }

  dispose(): void {
    if (this.linger !== null) clearTimeout(this.linger);
    this.listeners.clear();
  }

  private flyIn(delay: number): void {
    const goal = canvasProjection("3d").arrive(this.rig.view, this.canvas.pose());
    this.rig.flyTo(goal, () => this.canvas.arrived(this.rig.view.zoom), delay);
  }

  private set(patch: Partial<HandoverState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
