import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import type { CanvasNode } from "@kb/canvas";
import { upsertCanvasEdge, upsertCanvasNode } from "@kb/canvas";
import { Bullet } from "@/components/outline/bullet";
import { NodeRow } from "@/components/outline/node-row";
import { CanvasOverlays } from "@/components/canvas/canvas-overlays";
import { CanvasStage } from "@/components/canvas/canvas-stage";
import { useCanvasDoc } from "@/components/canvas/use-canvas-doc";
import { createCanvasEdgeActions } from "@/components/canvas/use-canvas-edge-actions";
import { useCanvasGestures } from "@/components/canvas/use-canvas-gestures";
import { useCanvasKeyboard } from "@/components/canvas/use-canvas-keyboard";
import { useCanvasSelection } from "@/components/canvas/use-canvas-selection";
import { listRefFields } from "@/lib/canvas-api";
import type { ToolState } from "@/lib/canvas-tool";
import { EMPTY_SELECTION, deleteSelected, selectNode as selNode } from "@/lib/canvas-selection";
import {
  createPointerState,
  pointerReduce,
  type CanvasPointerEvent,
  type PointerResult,
  type PointerState,
} from "@/lib/canvas-pointer";
import { navigate } from "@/lib/router";
import { useOutlineStore } from "@/stores/outline.store";

interface CanvasPageProps {
  canvasId: string;
}

export function CanvasPage({ canvasId }: CanvasPageProps) {
  const nodes = useOutlineStore((s) => s.nodes);
  const queryDb = useOutlineStore((s) => s.index);
  const rev = useOutlineStore((s) => s.index?.generation ?? 0);
  const canvasNode = nodes.get(canvasId);

  const [pointerState, setPointerState] = useReducer(
    (_current: PointerState, next: PointerState) => next,
    createPointerState(),
  );
  const pointerRef = useRef(pointerState);
  pointerRef.current = pointerState;
  const isInteracting = useCallback(() => pointerRef.current.drag !== null, []);
  const {
    doc,
    docRef,
    cancelPreview,
    schedulePersist,
    previewDoc,
    flushPersist,
    undo: undoCanvasDoc,
    redo: redoCanvasDoc,
  } = useCanvasDoc({ canvasId, canvasNode, nodes, rev, isInteracting });
  const { pan, marqueeRect, snapGuides } = pointerState;

  const [zoom, setZoom] = useState(1);
  const [spaceDown, setSpaceDown] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [toolState, setToolState] = useState<ToolState>({ tool: "select" });
  const [editingEdgeLabel, setEditingEdgeLabel] = useState<string | null>(null);

  const byId = useMemo(() => {
    const m = new Map<string, CanvasNode>();
    for (const n of doc.nodes) m.set(n.id, n);
    return m;
  }, [doc.nodes]);

  const {
    inspectorAnchor,
    onCardPointerDown,
    onEdgeClick,
    selectedEdge: selectedEdgeObj,
    selectedShape,
    selection,
    selectionRef: selRef,
    setInspectorAnchor,
    setSelection,
    setShapeInspectorAnchor,
    shapeInspectorAnchor,
  } = useCanvasSelection(doc, byId);

  const applyPointerResult = useCallback(
    (next: PointerResult) => {
      pointerRef.current = next.state;
      setPointerState(next.state);
      if (next.selection) setSelection(next.selection);
      if (next.persist === "cancel") {
        cancelPreview();
        return;
      }
      if (!next.doc) return;
      if (next.persist === "silent") previewDoc(next.doc);
      else if (next.persist === "flush") void flushPersist(next.doc);
      else if (next.persist === "history") schedulePersist(next.doc);
    },
    [cancelPreview, flushPersist, schedulePersist, previewDoc, setSelection],
  );

  const dispatchPointer = useCallback(
    (event: CanvasPointerEvent): PointerResult => {
      const next = pointerReduce(pointerRef.current, event, {
        doc: docRef.current,
        selection: selRef.current,
        zoom,
        byId,
      });
      applyPointerResult(next);
      return next;
    },
    [applyPointerResult, byId, docRef, selRef, zoom],
  );

  const refFields = useMemo(() => listRefFields(nodes), [nodes]);

  const {
    addKbNode,
    onDoubleClickStage,
    onPointerDownStage,
    onPointerMove,
    onPointerUp,
    onWheel,
    setTool,
    setToolSticky,
    startMoveForSelection,
    zoomToFit,
  } = useCanvasGestures({
    docRef,
    pointerRef,
    pan,
    zoom,
    spaceDown,
    toolState,
    dispatchPointer,
    schedulePersist,
    flushPersist,
    setInspectorAnchor,
    setPickerOpen,
    setSelection,
    setShapeInspectorAnchor,
    setToolState,
    setZoom,
  });

  const cancelPointer = useCallback(() => {
    dispatchPointer({ type: "pointer/cancel" });
  }, [dispatchPointer]);

  useCanvasKeyboard({
    cancelPointer,
    byId,
    docRef,
    selRef,
    schedulePersist,
    undoCanvasDoc,
    redoCanvasDoc,
    zoomToFit,
    setSelection,
    setInspectorAnchor,
    setShapeInspectorAnchor,
    setPickerOpen,
    setSpaceDown,
    setToolState,
    setZoom,
  });

  const { onDeleteEdge, onFieldChange, onModeChange } = createCanvasEdgeActions({
    selectedEdge: selectedEdgeObj,
    byId,
    docRef,
    nodes,
    queryDb,
    flushPersist,
    setSelection,
    setInspectorAnchor,
  });

  if (!canvasNode) {
    return (
      <div className="p-6 text-[13px] text-destructive">
        Canvas not found: {canvasId}{" "}
        <button type="button" className="underline" onClick={() => navigate("/canvas")}>
          back
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-foreground/[0.06] px-3">
        <button
          type="button"
          className="text-[12px] text-foreground/40 hover:text-foreground/70"
          onClick={() => navigate("/canvas")}
        >
          ← canvases
        </button>
        <NodeRow
          depth={0}
          nodeId={canvasId}
          bullet={<Bullet node={canvasNode} onClick={() => {}} />}
          content={
            <span className="truncate text-[13px] text-foreground/70">{canvasNode.text}</span>
          }
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          className="rounded-md border border-foreground/10 px-2 py-1 text-[12px] text-foreground/60 hover:bg-foreground/5"
          onClick={() => setPickerOpen(true)}
        >
          Add node
        </button>
        <span className="text-[11px] text-foreground/30">{Math.round(zoom * 100)}%</span>
      </div>

      <div className="relative min-h-0 flex flex-1">
        <CanvasStage
          doc={doc}
          nodes={nodes}
          byId={byId}
          selection={selection}
          pan={pan}
          zoom={zoom}
          spaceDown={spaceDown}
          toolState={toolState}
          editingEdgeLabel={editingEdgeLabel}
          edgeDrag={pointerState.drag?.kind === "edge" ? pointerState.drag : null}
          snapGuides={snapGuides}
          marqueeRect={marqueeRect}
          onEditingEdgeLabelChange={setEditingEdgeLabel}
          onEdgeLabelCommit={(edge, label) => {
            const updated = { ...edge, label: label || undefined };
            if (!label) delete updated.label;
            schedulePersist(upsertCanvasEdge(docRef.current, updated));
          }}
          onCardSelect={(card, anchor) => {
            setSelection(selNode(card.id));
            setInspectorAnchor(null);
            setShapeInspectorAnchor(anchor ?? null);
          }}
          onCardChange={(card) => schedulePersist(upsertCanvasNode(docRef.current, card))}
          onResizeStart={(cardId, corner, screen) => {
            dispatchPointer({ type: "resize/start", id: cardId, corner, screen });
          }}
          onPortDown={(cardId, side, screen) => {
            dispatchPointer({
              type: "edge/start",
              fromCardId: cardId,
              fromSide: side,
              screen,
            });
          }}
          onWheel={onWheel}
          onPointerDownStage={onPointerDownStage}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelPointer}
          onDoubleClickStage={onDoubleClickStage}
          handleCardPointerDown={(card, event, anchor) => {
            onCardPointerDown(card, event, anchor, startMoveForSelection);
          }}
          handleEdgeClick={onEdgeClick}
        />
        <CanvasOverlays
          selection={selection}
          toolState={toolState}
          selectedEdge={selectedEdgeObj}
          selectedShape={selectedShape}
          inspectorAnchor={inspectorAnchor}
          shapeInspectorAnchor={shapeInspectorAnchor}
          pickerOpen={pickerOpen}
          refFields={refFields}
          onToolChange={setTool}
          onToolDoubleClick={setToolSticky}
          onBringToFront={() => {
            const current = docRef.current;
            const kept = current.nodes.filter((node) => !selection.nodeIds.has(node.id));
            const moved = current.nodes.filter((node) => selection.nodeIds.has(node.id));
            schedulePersist({ ...current, nodes: [...kept, ...moved] });
          }}
          onSendToBack={() => {
            const current = docRef.current;
            const moved = current.nodes.filter((node) => selection.nodeIds.has(node.id));
            const kept = current.nodes.filter((node) => !selection.nodeIds.has(node.id));
            schedulePersist({ ...current, nodes: [...moved, ...kept] });
          }}
          onDeleteSelection={() => {
            schedulePersist(deleteSelected(docRef.current, selection));
            setSelection(EMPTY_SELECTION);
          }}
          onCloseEdgeInspector={() => {
            setSelection(EMPTY_SELECTION);
            setInspectorAnchor(null);
          }}
          onEdgeModeChange={(mode) => void onModeChange(mode)}
          onEdgeFieldChange={(fieldId) => void onFieldChange(fieldId)}
          onDeleteEdge={() => void onDeleteEdge()}
          onEdgeChange={(edge) => schedulePersist(upsertCanvasEdge(docRef.current, edge))}
          onCloseShapeInspector={() => setShapeInspectorAnchor(null)}
          onShapeChange={(shape) => schedulePersist(upsertCanvasNode(docRef.current, shape))}
          onPickNode={addKbNode}
          onClosePicker={() => setPickerOpen(false)}
        />
      </div>
    </div>
  );
}
