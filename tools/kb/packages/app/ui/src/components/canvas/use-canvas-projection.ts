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
  faceOnView,
  isTopView,
  panOfView,
  poseOfView,
  presetView,
  screenToPlane,
  viewOfPan,
  withLens,
  type CanvasLens,
  type CanvasPoint,
  type CanvasView,
  type CanvasViewportControls,
  type FlatViewportControls,
  type ViewSize,
} from "./canvas-camera";
import { CanvasCameraRig } from "./canvas-camera-rig";
import type { CanvasPointerEvent, PointerResult } from "./canvas-pointer";
import { logError, prefersReducedMotion, readTiming } from "@kb/ui-sdk";
import { CanvasHandover, type HandoverCanvas } from "./canvas-handover";

/**
 * The canvas page's side of the projections: the one camera rig, the
 * handover between projections (`canvas-handover`), and the page's answers
 * that depend on which projection is showing — where a new card lands, and
 * which camera the keymap and the view widget drive.
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

/** What the 2D view's looks read and do: the page's camera, and its ways in and across. */
interface FlatLooks {
  readonly current: () => CanvasView;
  readonly size: () => ViewSize;
  /** The lens the canvas was last seen through in depth. */
  readonly depthLens: () => CanvasLens;
  /** Enter 3D looking from a view: the handover flies there from the top. */
  readonly enterLookingFrom: (view: CanvasView) => void;
  /** Set the 2D view's pan and zoom. */
  readonly face: (pan: CanvasPoint, zoom: number) => void;
}

/**
 * The 2D camera's answers to a view, a preset, a lens or a face-on look:
 * 2D is the top view through the orthographic lens, so it shows a top view
 * itself and any other look is a way into 3D. A preset keeps the lens the
 * canvas was last seen through in depth.
 */
function lookFromTop(flat: FlatViewportControls, page: FlatLooks): CanvasViewportControls {
  /** The top view through the lens the canvas was last seen through in depth. */
  const inDepth = () => withLens(page.current(), page.depthLens());
  const show = (view: CanvasView) => {
    if (!isTopView(view)) {
      page.enterLookingFrom(view);
      return;
    }
    const flatView = panOfView(view, page.size());
    page.face(flatView.pan, flatView.zoom);
  };
  return {
    ...flat,
    show,
    faceOn: (item) => {
      const facing = faceOnView(item, page.size(), inDepth());
      if (facing !== null) show(facing);
    },
    look: (preset) => show(presetView(inDepth(), preset)),
    toggleLens: () => page.enterLookingFrom(withLens(page.current(), "perspective")),
  };
}

export function useCanvasProjection(context: ProjectionContext) {
  const { doc, pan, zoom, stage, setCamera, setZoom, dispatchPointer } = context;
  const [rig] = useState(
    () =>
      new CanvasCameraRig(viewOfPan(pan, zoom, sizeOf(null)), readTiming(), prefersReducedMotion()),
  );
  const [handover] = useState(() => new CanvasHandover(rig, readTiming(), UNMOUNTED));
  /** The 3D view as it last came to rest: what the screen state reports. */
  const [settled3d, setSettled3d] = useState<CanvasView | null>(null);
  /** Set the 2D view's pan and zoom. */
  const face = (next: CanvasPoint, nextZoom: number) => {
    dispatchPointer({ type: "pan/set", pan: next });
    setZoom(nextZoom);
  };
  // What the handover reads when it acts: the page as of its last commit.
  useLayoutEffect(() => {
    const pose = doc.camera?.pose;
    handover.bind({
      flat: () => ({ pan, zoom }),
      size: () => sizeOf(stage.current),
      pose: () => pose,
      face,
      arrived: (arrivedZoom) => {
        setZoom(arrivedZoom);
        setSettled3d(rig.view);
      },
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
    setSettled3d(rig.view);
    const pose = poseOfView(rig.view);
    // Back where it was: nothing to save.
    if (posesAgree(pose, doc.camera?.pose)) return;
    setCamera(cameraLookingFrom(doc.camera, "3d", pose));
  };

  const retryDepth = () => {
    if (!state.failed) return;
    handover.retry();
    handover.want("3d");
  };

  const choose = (kind: CanvasProjectionKind) => {
    if (kind === "3d") retryDepth();
    if (kind === projectionOf(doc.camera)) return;
    // Leaving 3D keeps the pose it was looked at from, to come back to.
    const kept = in3d ? poseOfView(rig.view) : doc.camera?.pose;
    setCamera(cameraLookingFrom(doc.camera, kind, kept));
  };

  const current = (): CanvasView => (in3d ? rig.view : viewOfPan(pan, zoom, size()));

  /** Enter 3D looking from `view`: the handover flies there from the top. */
  const enterLookingFrom = (view: CanvasView) => {
    retryDepth();
    setCamera(cameraLookingFrom(doc.camera, "3d", poseOfView(view)));
  };

  const flatLooks: FlatLooks = {
    current,
    size,
    depthLens: () => (doc.camera?.pose?.fov === 0 ? "orthographic" : "perspective"),
    enterLookingFrom,
    face,
  };

  return {
    rig,
    target,
    shown: state.shown,
    settled3d,
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
    /** The showing camera and the viewport it draws on: what every gesture is read through. */
    camera: () => ({ view: current(), size: size() }),
    /** The 2D view's camera, as the camera model holds it (the top view, orthographic). */
    flatView: (): CanvasView => viewOfPan(pan, zoom, size()),
    /** The showing camera's answers to the keymap and the view widget, given the 2D ones. */
    viewportOf: (flatControls: FlatViewportControls): CanvasViewportControls =>
      in3d ? rig.controls(size, onViewSettled) : lookFromTop(flatControls, flatLooks),
  };
}
