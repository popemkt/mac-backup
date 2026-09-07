import { useCallback } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { ulid } from "ulid";
import type { CanvasDoc } from "@kb/canvas";
import { isShapeNode, upsertCanvasNode } from "@kb/canvas";
import {
  placeWithTool,
  reduceCanvasTool,
  type CanvasTool,
  type ToolState,
} from "@/lib/canvas-tool";
import { selectNode as selNode } from "@/lib/canvas-selection";
import type { CanvasSelection } from "@/lib/canvas-selection";
import type { CanvasPointerEvent, PointerResult, PointerState } from "@/lib/canvas-pointer";
import { asElement, asInstance } from "@/lib/dom";
import { clampZoom, clientToCanvas } from "@/lib/canvas-viewport";

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
  setShapeInspectorAnchor: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setToolState: Dispatch<SetStateAction<ToolState>>;
  setZoom: Dispatch<SetStateAction<number>>;
}

type StageGestureContext = Pick<
  CanvasGestureContext,
  | "dispatchPointer"
  | "docRef"
  | "pointerRef"
  | "schedulePersist"
  | "setInspectorAnchor"
  | "setSelection"
  | "setShapeInspectorAnchor"
  | "setToolState"
  | "spaceDown"
  | "toolState"
>;

type ScreenToWorld = (
  clientX: number,
  clientY: number,
  element: HTMLElement,
) => { x: number; y: number };

function createPointerEnd(context: StageGestureContext, screenToWorld: ScreenToWorld) {
  return (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = context.pointerRef.current.drag;
    if (drag?.kind === "marquee-pending") {
      context.setInspectorAnchor(null);
      context.setShapeInspectorAnchor(null);
    }
    const edgeTarget =
      drag?.kind === "edge"
        ? asInstance(
            document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-card-id]"),
            HTMLElement,
          )?.dataset.cardId
        : undefined;
    const edgeWorld =
      drag?.kind === "edge"
        ? screenToWorld(event.clientX, event.clientY, event.currentTarget)
        : undefined;
    const next = context.dispatchPointer({
      type: "pointer/end",
      shiftKey: event.shiftKey,
      screen: { x: event.clientX, y: event.clientY },
      edgeTargetId: edgeTarget,
      edgeWorld,
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
  const zoomToFit = useCallback(() => {
    const docNodes = docRef.current.nodes;
    if (docNodes.length === 0) return;
    const stageEl = document.querySelector("[data-canvas-viewport]");
    if (!stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    const PAD = 40;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of docNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    if (contentW <= 0 || contentH <= 0) return;
    const scaleX = (rect.width - PAD * 2) / contentW;
    const scaleY = (rect.height - PAD * 2) / contentH;
    const newZoom = clampZoom(Math.min(scaleX, scaleY, 1));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    dispatchPointer({
      type: "pan/set",
      pan: {
        x: rect.width / 2 - cx * newZoom,
        y: rect.height / 2 - cy * newZoom,
      },
    });
    setZoom(newZoom);
  }, [dispatchPointer, docRef, setZoom]);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number, el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      return clientToCanvas({ x: clientX, y: clientY }, rect, pan, zoom);
    },
    [pan, zoom],
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
  return { onWheel, screenToWorld, zoomToFit };
}

function createStageGestures(
  {
    dispatchPointer,
    docRef,
    pointerRef,
    schedulePersist,
    setInspectorAnchor,
    setSelection,
    setShapeInspectorAnchor,
    setToolState,
    spaceDown,
    toolState,
  }: StageGestureContext,
  screenToWorld: ScreenToWorld,
) {
  const startMoveForSelection = (e: React.PointerEvent, clickedId: string) => {
    dispatchPointer({
      type: "move/start",
      id: clickedId,
      screen: { x: e.clientX, y: e.clientY },
    });
    asElement(e.target)?.setPointerCapture(e.pointerId);
  };

  const onPointerDownStage = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || spaceDown || (e.button === 0 && e.altKey)) {
      dispatchPointer({ type: "pan/start", screen: { x: e.clientX, y: e.clientY } });
      asElement(e.target)?.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 0 && isEmptyStageTarget(e.target)) {
      const placed = placeWithTool(
        docRef.current,
        toolState.tool,
        screenToWorld(e.clientX, e.clientY, e.currentTarget),
        ulid(),
      );
      if (placed) {
        schedulePersist(placed.doc);
        setSelection(selNode(placed.node.id));
        setToolState((s) => reduceCanvasTool(s, { type: "placed" }));
        setInspectorAnchor(null);
        setShapeInspectorAnchor(null);
        if (isShapeNode(placed.node)) {
          setShapeInspectorAnchor({ x: e.clientX, y: e.clientY });
        }
        return;
      }
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
    const card = {
      id: ulid(),
      type: "text" as const,
      text: "",
      x: world.x,
      y: world.y,
      width: 220,
      height: 80,
    };
    schedulePersist(upsertCanvasNode(docRef.current, card));
    setSelection(selNode(card.id));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    dispatchPointer({
      type: "pointer/move",
      screen: { x: e.clientX, y: e.clientY },
      world: screenToWorld(e.clientX, e.clientY, e.currentTarget),
      shiftKey: e.shiftKey,
    });
  };

  const onPointerUp = createPointerEnd(
    {
      dispatchPointer,
      docRef,
      pointerRef,
      schedulePersist,
      setInspectorAnchor,
      setSelection,
      setShapeInspectorAnchor,
      setToolState,
      spaceDown,
      toolState,
    },
    screenToWorld,
  );
  return {
    onDoubleClickStage,
    onPointerDownStage,
    onPointerMove,
    onPointerUp,
    startMoveForSelection,
  };
}

function createAddKbNode({
  docRef,
  flushPersist,
  pan,
  setPickerOpen,
  setSelection,
  zoom,
}: Pick<
  CanvasGestureContext,
  "docRef" | "flushPersist" | "pan" | "setPickerOpen" | "setSelection" | "zoom"
>) {
  const addKbNode = (nodeId: string) => {
    setPickerOpen(false);
    const card = {
      id: ulid(),
      type: "kb-node" as const,
      nodeId,
      x: (200 - pan.x) / zoom,
      y: (160 - pan.y) / zoom,
      width: 280,
      height: 72,
    };
    void flushPersist(upsertCanvasNode(docRef.current, card));
    setSelection(selNode(card.id));
  };
  return addKbNode;
}

export function useCanvasGestures(context: CanvasGestureContext) {
  const toolControls = useToolControls(context);
  const viewport = useViewportControls(context);
  const stage = createStageGestures(context, viewport.screenToWorld);
  return {
    addKbNode: createAddKbNode(context),
    ...stage,
    ...toolControls,
    ...viewport,
  };
}
