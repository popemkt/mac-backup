import { useEffect, useRef, useState, type RefObject } from "react";
import type { CanvasDoc, CanvasProjectionKind } from "@kb/canvas";
import { SCREEN_APPLIED, screenRejected, type CanvasScreen, type ScreenAck } from "@kb/contracts";
import { poseOfView, viewOfPan, type CanvasView } from "@/lib/canvas-camera";
import { visibleItemIds } from "@/lib/canvas-visible";
import type { CanvasSelection } from "@/lib/canvas-selection";
import type { PaneSelection } from "@/lib/pane-screen";
import { usePaneScreen } from "@/stores/screen.store";

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
 * carry out a `ui.select` of item ids. A canvas has no focus to move. In 3D
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
    select,
  );
}
