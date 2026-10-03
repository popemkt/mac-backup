import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import {
  cameraLookingFrom,
  posesAgree,
  projectionOf,
  type CanvasCamera,
  type CanvasDoc,
  type CanvasProjectionKind,
} from "@kb/canvas";
import {
  poseOfView,
  screenToPlane,
  viewOfPan,
  type CanvasPoint,
  type CanvasView,
  type CanvasViewportControls,
  type ViewSize,
} from "@/lib/canvas-camera";
import { CanvasCameraRig } from "@/lib/canvas-camera-rig";
import type { CanvasPointerEvent, PointerResult } from "@/lib/canvas-pointer";
import { logError } from "@/lib/log";
import { prefersReducedMotion } from "@/lib/motion";
import { readTiming } from "@/lib/timing";
import { CanvasHandover, type HandoverCanvas } from "./canvas-handover";

/**
 * The canvas page's side of the projections: the one camera rig, the
 * handover between projections (`canvas-handover`), and the page's answers
 * that depend on which projection is showing — where a new card lands, and
 * which camera the keymap drives.
 */
interface ProjectionContext {
  readonly doc: CanvasDoc;
  readonly pan: CanvasPoint;
  readonly zoom: number;
  readonly stage: React.RefObject<HTMLDivElement | null>;
  readonly setCamera: (camera: CanvasCamera) => void;
  readonly setZoom: (zoom: number) => void;
  readonly dispatchPointer: (event: CanvasPointerEvent) => PointerResult;
}

/** Where a new card lands: this far into the viewport from its corner, on the canvas plane. */
const PLACEMENT = { x: 200, y: 160 } as const;

/** Before the page has committed there is nothing to read or hand to. */
const UNMOUNTED: HandoverCanvas = {
  flat: () => ({ pan: { x: 0, y: 0 }, zoom: 1 }),
  size: () => ({ width: 1, height: 1 }),
  pose: () => undefined,
  face: () => {},
  arrived: () => {},
};

function sizeOf(stage: HTMLDivElement | null): ViewSize {
  if (stage === null) return { width: 1, height: 1 };
  return { width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight) };
}

export function useCanvasProjection(context: ProjectionContext) {
  const { doc, pan, zoom, stage, setCamera, setZoom, dispatchPointer } = context;
  const [rig] = useState(
    () =>
      new CanvasCameraRig(viewOfPan(pan, zoom, sizeOf(null)), readTiming(), prefersReducedMotion()),
  );
  const [handover] = useState(() => new CanvasHandover(rig, readTiming(), UNMOUNTED));
  // What the handover reads when it acts: the page as of its last commit.
  useLayoutEffect(() => {
    const pose = doc.camera?.pose;
    handover.bind({
      flat: () => ({ pan, zoom }),
      size: () => sizeOf(stage.current),
      pose: () => pose,
      face: (next, nextZoom) => {
        dispatchPointer({ type: "pan/set", pan: next });
        setZoom(nextZoom);
      },
      arrived: setZoom,
    });
  });
  useEffect(() => () => handover.dispose(), [handover]);
  const state = useSyncExternalStore(handover.subscribe, handover.snapshot);
  const target: CanvasProjectionKind = state.failed ? "2d" : projectionOf(doc.camera);
  useEffect(() => handover.want(target), [handover, target]);

  const in3d = state.shown === "3d";
  const size = () => sizeOf(stage.current);

  /** A 3D gesture came to rest: the pose is saved, and the header shows its zoom. */
  const onViewSettled = () => {
    if (!in3d || target !== "3d") return;
    setZoom(rig.view.zoom);
    const pose = poseOfView(rig.view);
    // Back where it was: nothing to save.
    if (posesAgree(pose, doc.camera?.pose)) return;
    setCamera(cameraLookingFrom(doc.camera, "3d", pose));
  };

  const choose = (kind: CanvasProjectionKind) => {
    if (kind === "3d" && state.failed) {
      handover.retry();
      handover.want("3d");
    }
    if (kind === projectionOf(doc.camera)) return;
    // Leaving 3D keeps the pose it was looked at from, to come back to.
    const kept = in3d ? poseOfView(rig.view) : doc.camera?.pose;
    setCamera(cameraLookingFrom(doc.camera, kind, kept));
  };

  const current = (): CanvasView => (in3d ? rig.view : viewOfPan(pan, zoom, size()));

  return {
    rig,
    target,
    shown: state.shown,
    /** The 3D layer is mounted: showing, about to, or fading out. */
    mounted3d: in3d || state.phase !== null,
    entry: state.entry,
    choose,
    onSceneReady: () => handover.ready(target),
    onSceneError: (error: Error) => {
      logError("[kb/canvas] 3D scene failed to start:", error.message);
      handover.fail();
    },
    onViewSettled,
    /** Where a card added from the header lands, in whichever projection is showing. */
    placementPoint: (): CanvasPoint => {
      const at = screenToPlane(current(), size(), PLACEMENT, 0);
      return at === null ? { x: 0, y: 0 } : { x: at.x, y: at.y };
    },
    /** The showing camera's answers to the keymap, given the 2D ones. */
    viewportOf: (flatControls: CanvasViewportControls): CanvasViewportControls =>
      in3d ? rig.controls(size, onViewSettled) : flatControls,
  };
}
