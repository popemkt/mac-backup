import { useCallback } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { ulid } from "ulid";
import type { CanvasDoc } from "@kb/canvas";
import { isShapeNode, paintOrder, presetItem, upsertCanvasNode } from "@kb/canvas";
import { placeWithTool, reduceCanvasTool, type CanvasTool, type ToolState } from "./canvas-tool";
import { selectNode as selNode } from "./canvas-selection";
import type { CanvasSelection } from "./canvas-selection";
import type {
  CanvasPointerEvent,
  PointerResult,
  PointerState,
  ResizeCorner,
} from "./canvas-pointer";
import { asElement } from "@/sdk";
import {
  clampZoom,
  clientToCanvas,
  fitView,
  hitTest,
  panOfView,
  viewOfPan,
  type CanvasHitItem,
  type FlatViewportControls,
} from "./canvas-camera";

interface CanvasGestureContext {
  docRef: RefObject<CanvasDoc>;
  pointerRef: RefObject<PointerState>;
  pan: PointerState["pan"];
  zoom: number;
  spaceDown: boolean;
  toolState: ToolState;
  dispatchPointer: (event: CanvasPointerEvent) => PointerResult;
  schedulePersist: (doc: CanvasDoc) => void;
  flushPersist: (doc: CanvasDoc) => Promise<void>;
  setInspectorAnchor: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setPickerOpen: Dispatch<SetStateAction<boolean>>;
  setSelection: Dispatch<SetStateAction<CanvasSelection>>;
  setItemInspectorAnchor: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setToolState: Dispatch<SetStateAction<ToolState>>;
  setZoom: Dispatch<SetStateAction<number>>;
  /** Where a card added from the header lands, in the projection that is showing. */
  placementPoint: () => { x: number; y: number };
}

type StageGestureContext = Pick<
  CanvasGestureContext,
  | "dispatchPointer"
  | "docRef"
  | "pointerRef"
  | "schedulePersist"
  | "setInspectorAnchor"
  | "setSelection"
  | "setItemInspectorAnchor"
  | "setToolState"
  | "spaceDown"
  | "toolState"
>;

type ScreenToWorld = (
  clientX: number,
  clientY: number,
  element: HTMLElement,
) => { x: number; y: number };

/** The card under a client point, as the camera sees it (`hitTest`). */
type CardAt = (clientX: number, clientY: number, element: HTMLElement) => string | null;

function createPointerEnd(
  context: StageGestureContext,
  screenToWorld: ScreenToWorld,
  cardAt: CardAt,
) {
  return (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = context.pointerRef.current.drag;
    if (drag?.kind === "marquee-pending") {
      context.setInspectorAnchor(null);
      context.setItemInspectorAnchor(null);
    }
    const edgeTarget =
      drag?.kind === "edge"
        ? (cardAt(event.clientX, event.clientY, event.currentTarget) ?? undefined)
        : undefined;
    const next = context.dispatchPointer({
      type: "pointer/end",
      shiftKey: event.shiftKey,
      free: event.metaKey,
      screen: { x: event.clientX, y: event.clientY },
      world: screenToWorld(event.clientX, event.clientY, event.currentTarget),
      edgeTargetId: edgeTarget,
      edgeId: drag?.kind === "edge" ? ulid() : undefined,
      edgeBindingId: drag?.kind === "edge" ? ulid() : undefined,
    });
    if (next.persist === "flush") {
      context.setInspectorAnchor({ x: event.clientX, y: event.clientY });
    }
  };
}

const isEmptyStageTarget = (target: EventTarget | null) => {
  const el = asElement(target);
  if (el === undefined) return false;
  if (el.closest("[data-card-id]") !== null) return false;
  if (el.closest("[data-testid='canvas-toolbar']") !== null) return false;
  if (el.closest("path") !== null) return false;
  return true;
};

function useToolControls({
  setPickerOpen,
  setToolState,
}: Pick<CanvasGestureContext, "setPickerOpen" | "setToolState">) {
  const setTool = useCallback(
    (tool: CanvasTool) => {
      if (tool === "kb-node") {
        setToolState({ tool: "select" });
        setPickerOpen(true);
        return;
      }
      setToolState((state) => reduceCanvasTool(state, { type: "set-tool", tool }));
    },
    [setPickerOpen, setToolState],
  );
  const setToolSticky = useCallback(
    (tool: CanvasTool) => {
      if (tool === "kb-node" || tool === "select") return;
      setToolState((state) => reduceCanvasTool(state, { type: "set-tool-sticky", tool }));
    },
    [setToolState],
  );
  return { setTool, setToolSticky };
}

function useViewportControls({
  docRef,
  dispatchPointer,
  pan,
  setZoom,
  zoom,
}: Pick<CanvasGestureContext, "docRef" | "dispatchPointer" | "pan" | "setZoom" | "zoom">) {
  const frame = useCallback(
    (items: readonly CanvasHitItem[]) => {
      const stageEl = document.querySelector("[data-canvas-viewport]");
      if (!stageEl) return;
      const rect = stageEl.getBoundingClientRect();
      const fitted = fitView(items, rect, viewOfPan(pan, zoom, rect));
      if (fitted === null) return;
      const framed = panOfView(fitted, rect);
      dispatchPointer({ type: "pan/set", pan: framed.pan });
      setZoom(framed.zoom);
    },
    [dispatchPointer, pan, setZoom, zoom],
  );

  const screenToWorld = useCallback(
    (clientX: number, clientY: number, el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      return clientToCanvas({ x: clientX, y: clientY }, rect, pan, zoom);
    },
    [pan, zoom],
  );

  const cardAt = useCallback(
    (clientX: number, clientY: number, el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const local = { x: clientX - rect.left, y: clientY - rect.top };
      return hitTest(paintOrder(docRef.current.nodes), viewOfPan(pan, zoom, rect), rect, local);
    },
    [docRef, pan, zoom],
  );

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const newZoom = clampZoom(zoom * factor);
      // Cursor-centered zoom
      const rect = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const worldX = (px - pan.x) / zoom;
      const worldY = (py - pan.y) / zoom;
      dispatchPointer({
        type: "pan/set",
        pan: {
          x: px - worldX * newZoom,
          y: py - worldY * newZoom,
        },
      });
      setZoom(newZoom);
      return;
    }
    dispatchPointer({
      type: "pan/set",
      pan: { x: pan.x - e.deltaX, y: pan.y - e.deltaY },
    });
  };
  /** The top-view camera's answers to the keymap; a key zooms with the pan held, as it always has. */
  const viewportControls: FlatViewportControls = {
    zoomBy: (factor) => setZoom((current) => clampZoom(current * factor)),
    zoomTo: (next) => setZoom(clampZoom(next)),
    frame,
  };
  return { cardAt, onWheel, screenToWorld, viewportControls };
}

/**
 * A press on a card or its handle starts a gesture at the canvas point under
 * it, read through the viewport the gesture is over.
 */
function createCardGestures(
  dispatchPointer: CanvasGestureContext["dispatchPointer"],
  screenToWorld: ScreenToWorld,
) {
  const worldAt = (clientX: number, clientY: number) => {
    const stageEl = document.querySelector<HTMLElement>("[data-canvas-viewport]");
    return stageEl ? screenToWorld(clientX, clientY, stageEl) : { x: clientX, y: clientY };
  };
  const startMoveForSelection = (e: React.PointerEvent, clickedId: string) => {
    dispatchPointer({
      type: "move/start",
      id: clickedId,
      screen: { x: e.clientX, y: e.clientY },
      world: worldAt(e.clientX, e.clientY),
    });
    asElement(e.target)?.setPointerCapture(e.pointerId);
  };
  const startResize = (cardId: string, corner: ResizeCorner, screen: { x: number; y: number }) => {
    dispatchPointer({
      type: "resize/start",
      id: cardId,
      corner,
      screen,
      world: worldAt(screen.x, screen.y),
    });
  };
  const startRotate = (cardId: string, screen: { x: number; y: number }) => {
    dispatchPointer({ type: "turn/start", id: cardId, screen, world: worldAt(screen.x, screen.y) });
  };
  return { startMoveForSelection, startResize, startRotate };
}

/**
 * A press on empty canvas with a placing tool drops its item at the canvas
 * point under the press, in whichever projection saw it; false when the tool
 * places nothing (select), so the press means something else there.
 */
function createToolPlacement({
  docRef,
  schedulePersist,
  setInspectorAnchor,
  setSelection,
  setItemInspectorAnchor,
  setToolState,
  toolState,
}: StageGestureContext) {
  return (world: { x: number; y: number }, client: { x: number; y: number }): boolean => {
    const placed = placeWithTool(docRef.current, toolState.tool, world, ulid());
    if (!placed) return false;
    schedulePersist(placed.doc);
    setSelection(selNode(placed.node.id));
    setToolState((s) => reduceCanvasTool(s, { type: "placed" }));
    setInspectorAnchor(null);
    setItemInspectorAnchor(isShapeNode(placed.node) ? client : null);
    return true;
  };
}

function createStageGestures(
  context: StageGestureContext,
  screenToWorld: ScreenToWorld,
  cardAt: CardAt,
) {
  const { dispatchPointer, docRef, schedulePersist, setSelection, spaceDown, toolState } = context;
  const placeAt = createToolPlacement(context);
  const onPointerDownStage = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || spaceDown || (e.button === 0 && e.altKey)) {
      dispatchPointer({ type: "pan/start", screen: { x: e.clientX, y: e.clientY } });
      asElement(e.target)?.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 0 && isEmptyStageTarget(e.target)) {
      const client = { x: e.clientX, y: e.clientY };
      if (placeAt(screenToWorld(e.clientX, e.clientY, e.currentTarget), client)) return;
      // Begin marquee or clear selection
      const world = screenToWorld(e.clientX, e.clientY, e.currentTarget);
      dispatchPointer({
        type: "marquee/start",
        screen: { x: e.clientX, y: e.clientY },
        world,
        additive: e.shiftKey,
      });
      asElement(e.target)?.setPointerCapture(e.pointerId);
    }
  };

  const onDoubleClickStage = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isEmptyStageTarget(e.target)) return;
    if (toolState.tool !== "select") return;
    const world = screenToWorld(e.clientX, e.clientY, e.currentTarget);
    const card = presetItem("text", world, ulid());
    schedulePersist(upsertCanvasNode(docRef.current, card));
    setSelection(selNode(card.id));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    dispatchPointer({
      type: "pointer/move",
      screen: { x: e.clientX, y: e.clientY },
      world: screenToWorld(e.clientX, e.clientY, e.currentTarget),
      shiftKey: e.shiftKey,
      free: e.metaKey,
    });
  };

  const onPointerUp = createPointerEnd(context, screenToWorld, cardAt);
  return {
    onDoubleClickStage,
    onPointerDownStage,
    onPointerMove,
    onPointerUp,
    placeAt,
  };
}

function createAddKbNode({
  docRef,
  flushPersist,
  placementPoint,
  setPickerOpen,
  setSelection,
}: Pick<
  CanvasGestureContext,
  "docRef" | "flushPersist" | "placementPoint" | "setPickerOpen" | "setSelection"
>) {
  const addKbNode = (nodeId: string) => {
    setPickerOpen(false);
    const card = presetItem("kb-node", placementPoint(), ulid(), nodeId);
    void flushPersist(upsertCanvasNode(docRef.current, card));
    setSelection(selNode(card.id));
  };
  return addKbNode;
}

export function useCanvasGestures(context: CanvasGestureContext) {
  const toolControls = useToolControls(context);
  const viewport = useViewportControls(context);
  const stage = createStageGestures(context, viewport.screenToWorld, viewport.cardAt);
  const cards = createCardGestures(context.dispatchPointer, viewport.screenToWorld);
  return {
    ...cards,
    addKbNode: createAddKbNode(context),
    ...stage,
    ...toolControls,
    ...viewport,
  };
}
