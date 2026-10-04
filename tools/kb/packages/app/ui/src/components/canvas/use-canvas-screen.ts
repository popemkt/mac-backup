import { useEffect, useRef, useState, type RefObject } from "react";
import type { CanvasDoc, CanvasProjectionKind } from "@kb/canvas";
import {
  SCREEN_APPLIED,
  screenRejected,
  type CanvasScreen,
  type CanvasViewTarget,
  type ScreenAck,
} from "@kb/contracts";
import {
  poseOfView,
  viewOfPan,
  viewOfTarget,
  type CanvasView,
  type CanvasViewportControls,
  type ViewSize,
} from "./canvas-camera";
import { visibleItemIds } from "./canvas-visible";
import type { CanvasSelection } from "./canvas-selection";
import { usePaneScreen, type PaneCommand, type PaneSelection } from "@kb/ui-sdk";

interface CanvasScreenInput {
  readonly canvasId: string;
  readonly doc: CanvasDoc;
  readonly pan: { readonly x: number; readonly y: number };
  readonly zoom: number;
  /** The projection showing, and in 3D the view it last came to rest at. */
  readonly shown: CanvasProjectionKind;
  readonly settled3d: CanvasView | null;
  readonly stage: RefObject<HTMLElement | null>;
  readonly selection: CanvasSelection;
  readonly setSelection: (selection: CanvasSelection) => void;
  /** The showing camera and its viewport, and how it is pointed: what a camera target moves. */
  readonly camera: () => { readonly view: CanvasView; readonly size: ViewSize };
  readonly viewport: CanvasViewportControls;
  /** Draw what a view sees, as a picture, the camera left where it is. */
  readonly capture: (view: CanvasView) => Promise<ScreenAck>;
}

interface Observed {
  readonly element: HTMLElement;
  readonly observer: ResizeObserver;
}

/**
 * The stage's size on screen, kept current as it resizes. The stage mounts
 * only once its canvas node is known, so after each render the observer
 * follows whatever element the ref holds now.
 */
function useStageSize(stage: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observed = useRef<Observed | null>(null);

  useEffect(() => {
    const element = stage.current;
    if (observed.current?.element === element) return;
    observed.current?.observer.disconnect();
    observed.current = null;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    observed.current = { element, observer };
  });

  useEffect(
    () => () => {
      observed.current?.observer.disconnect();
      observed.current = null;
    },
    [],
  );
  return size;
}

/**
 * Report the canvas's part of the screen — the canvas node, its selected
 * items, the camera of the projection showing and the items it shows — and
 * carry out a `ui.select` of item ids, and a `ui.navigate`'s camera target
 * through the showing camera (`viewOfTarget`, then `show`). A canvas has no
 * focus to move. In 3D
 * the camera is reported as it comes to rest, not on every frame of a drag.
 */
export function useCanvasScreen({
  canvasId,
  doc,
  pan,
  zoom,
  shown,
  settled3d,
  stage,
  selection,
  setSelection,
  camera,
  viewport,
  capture,
}: CanvasScreenInput): void {
  const { width, height } = useStageSize(stage);
  const size = { width, height };
  const view = shown === "3d" && settled3d !== null ? settled3d : viewOfPan(pan, zoom, size);
  const select = (command: PaneSelection): ScreenAck => {
    if (command.focus !== undefined) {
      return screenRejected("a canvas has no focus; select its items instead");
    }
    const ids = command.selection ?? [];
    const nodeIds = new Set(doc.nodes.map((item) => item.id));
    const edgeIds = new Set(doc.edges.map((edge) => edge.id));
    const unknown = ids.filter((id) => !nodeIds.has(id) && !edgeIds.has(id));
    if (unknown.length > 0) return screenRejected(`no item ${unknown.join(", ")} on this canvas`);
    setSelection({
      nodeIds: new Set(ids.filter((id) => nodeIds.has(id))),
      edgeIds: new Set(ids.filter((id) => edgeIds.has(id))),
    });
    return SCREEN_APPLIED;
  };
  /** The view a camera target names, from the showing camera; or why there is none. */
  const viewOf = (target: CanvasViewTarget | undefined): CanvasView | ScreenAck => {
    const now = camera();
    if (target === undefined) return now.view;
    const goal = viewOfTarget(target, doc.nodes, now.size, now.view);
    if (goal !== null) return goal;
    const missing = (target.items ?? []).filter((id) => !doc.nodes.some((n) => n.id === id));
    return screenRejected(
      missing.length > 0 ? `no item ${missing.join(", ")} on this canvas` : "nothing to look at",
    );
  };
  const carryOut = (command: PaneCommand): ScreenAck | Promise<ScreenAck> => {
    if (command.kind === "select") return select(command);
    const goal = viewOf(command.kind === "look" ? command.target : command.view);
    if ("outcome" in goal) return goal;
    // A look points the showing camera, as the view menu and present mode do; a capture leaves it.
    if (command.kind === "capture") return capture(goal);
    viewport.show(goal);
    return SCREEN_APPLIED;
  };
  usePaneScreen(
    {
      subject: canvasId,
      focused: null,
      selection: [...selection.nodeIds, ...selection.edgeIds],
      canvas: {
        projection: shown,
        // The document's pose shape is the screen's: the bridge is checked here.
        pose: { ...poseOfView(view), fov: view.fov } satisfies CanvasScreen["pose"],
        visible: visibleItemIds(doc.nodes, view, size),
      },
    },
    carryOut,
  );
}
