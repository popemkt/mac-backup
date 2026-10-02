import { useEffect, useRef, useState, type RefObject } from "react";
import type { CanvasDoc } from "@kb/canvas";
import { SCREEN_APPLIED, screenRejected, type ScreenAck } from "@kb/contracts";
import { visibleItemIds } from "@/lib/canvas-visible";
import type { CanvasSelection } from "@/lib/canvas-selection";
import { usePaneScreen, type PaneSelection } from "@/stores/screen.store";

interface CanvasScreenInput {
  readonly canvasId: string;
  readonly doc: CanvasDoc;
  readonly pan: { readonly x: number; readonly y: number };
  readonly zoom: number;
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
 * items, its 2D viewport and the items inside it — and carry out a
 * `ui.select` of item ids. A canvas has no focus to move.
 */
export function useCanvasScreen({
  canvasId,
  doc,
  pan,
  zoom,
  stage,
  selection,
  setSelection,
}: CanvasScreenInput): void {
  const { width, height } = useStageSize(stage);
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
        // The 2D camera, also while the canvas is seen in 3D.
        // GAP [[01M3YMCVN656CNRJ3F3R91MHKA]]
        viewport: { x: pan.x, y: pan.y, zoom },
        visible: visibleItemIds(doc.nodes, { pan, zoom, width, height }),
      },
    },
    select,
  );
}
