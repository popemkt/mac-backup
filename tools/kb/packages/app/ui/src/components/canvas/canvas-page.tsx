import {
  Suspense,
  lazy,
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { CanvasNode } from "@kb/canvas";
import { upsertCanvasEdge, upsertCanvasNode } from "@kb/canvas";
import {
  Bullet,
  cn,
  navigate,
  NodeRow,
  NotFound,
  useAppearance,
  useGeneration,
  useIndex,
  useNodes,
  useSchema,
} from "@/sdk";
import { useCanvasProjection } from "./use-canvas-projection";
import { CanvasOverlays } from "./canvas-overlays";
import { CanvasStage } from "./canvas-stage";
import { CanvasViewWidget } from "./canvas-view-widget";
import { useCanvasDoc } from "./use-canvas-doc";
import { createCanvasEdgeActions } from "./use-canvas-edge-actions";
import { useCanvasGestures } from "./use-canvas-gestures";
import { useCanvasKeyboard } from "./use-canvas-keyboard";
import { useCanvasScreen } from "./use-canvas-screen";
import { useCanvasSelection } from "./use-canvas-selection";
import { listRefFields } from "./canvas-api";
import type { ToolState } from "./canvas-tool";
import { FIRST_GIZMO, type GizmoChoice } from "./canvas-gizmo";
import { viewOfPan } from "./canvas-camera";
import type { TransformCamera } from "./canvas-transform-input";
import {
  EMPTY_SELECTION,
  deleteSelected,
  selectNode as selNode,
  selectionEmpty,
} from "./canvas-selection";
import {
  createPointerState,
  pointerReduce,
  type CanvasPointerEvent,
  type PointerResult,
  type PointerState,
} from "./canvas-pointer";

/** The 3D projection's chunk: three loads only when a canvas is looked at in depth. */
const Canvas3dStage = lazy(() => import("./canvas-3d-stage"));

interface CanvasPageProps {
  canvasId: string;
}

export function CanvasPage({ canvasId }: CanvasPageProps) {
  const nodes = useNodes();
  const schema = useSchema();
  const queryDb = useIndex();
  const rev = useGeneration();
  const canvasNode = nodes.get(canvasId);

  const [pointerState, setPointerState] = useReducer(
    (_current: PointerState, next: PointerState) => next,
    createPointerState(),
  );
  const pointerRef = useRef(pointerState);
  pointerRef.current = pointerState;
  /** The showing camera, which every gesture is read through; the projection's, once it is up. */
  const cameraRef = useRef<() => TransformCamera>(() => ({
    view: viewOfPan(pointerState.pan, 1, { width: 1, height: 1 }),
    size: { width: 1, height: 1 },
  }));
  const isInteracting = useCallback(() => pointerRef.current.drag !== null, []);
  const {
    doc,
    docRef,
    cancelPreview,
    schedulePersist,
    previewDoc,
    flushPersist,
    setCamera,
    undo: undoCanvasDoc,
    redo: redoCanvasDoc,
  } = useCanvasDoc({ canvasId, canvasNode, nodes, rev, isInteracting });
  const appearance = useAppearance();
  const { pan, marqueeRect, snapGuides } = pointerState;

  const [zoom, setZoom] = useState(1);
  const [spaceDown, setSpaceDown] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [toolState, setToolState] = useState<ToolState>({ tool: "select" });
  const [editingEdgeLabel, setEditingEdgeLabel] = useState<string | null>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [gizmo, setGizmo] = useState<GizmoChoice>(FIRST_GIZMO);

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
    selectedItem,
    selection,
    selectionRef: selRef,
    setInspectorAnchor,
    setSelection,
    setItemInspectorAnchor,
    itemInspectorAnchor,
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
        byId,
        ...cameraRef.current(),
      });
      applyPointerResult(next);
      return next;
    },
    [applyPointerResult, byId, docRef, selRef],
  );

  const refFields = useMemo(() => listRefFields(nodes), [nodes]);

  const stageRef = useRef<HTMLDivElement>(null);
  const projection = useCanvasProjection({
    doc,
    pan,
    zoom,
    stage: stageRef,
    setCamera,
    setZoom,
    dispatchPointer,
  });
  useLayoutEffect(() => {
    cameraRef.current = projection.camera;
  });
  const in3d = projection.shown === "3d";
  useCanvasScreen({
    canvasId,
    doc,
    pan,
    zoom,
    shown: projection.shown,
    settled3d: projection.settled3d,
    stage: stageRef,
    selection,
    setSelection,
  });

  const {
    addKbNode,
    onDoubleClickStage,
    onPointerDownStage,
    onPointerMove,
    onPointerUp,
    onWheel,
    placeAt,
    setTool,
    setToolSticky,
    startEdge,
    startMoveForSelection,
    startResize,
    startRotate,
    viewportControls,
  } = useCanvasGestures({
    placementPoint: projection.placementPoint,
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
    setItemInspectorAnchor,
    setToolState,
    setZoom,
  });

  const cancelPointer = useCallback(() => {
    dispatchPointer({ type: "pointer/cancel" });
  }, [dispatchPointer]);

  const viewport = projection.viewportOf(viewportControls);
  const applyIntent = useCanvasKeyboard({
    cancelPointer,
    byId,
    docRef,
    selRef,
    schedulePersist,
    undoCanvasDoc,
    redoCanvasDoc,
    setSelection,
    setInspectorAnchor,
    setItemInspectorAnchor,
    setPickerOpen,
    setSpaceDown,
    setToolState,
    viewport,
    chooseProjection: projection.choose,
    openViewMenu: () => setViewMenuOpen(true),
  });

  const { onDeleteEdge, onFieldChange, onModeChange } = createCanvasEdgeActions({
    selectedEdge: selectedEdgeObj,
    byId,
    docRef,
    nodes: schema,
    queryDb,
    flushPersist,
    setSelection,
    setInspectorAnchor,
  });

  if (!canvasNode) {
    return (
      <NotFound what="Canvas" id={canvasId} back={{ label: "All canvases", path: "/canvas" }} />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-foreground/[0.06] px-3">
        <button
          type="button"
          className="text-meta text-foreground/40 hover:text-foreground/70"
          onClick={() => navigate("/canvas")}
        >
          ← canvases
        </button>
        <NodeRow
          depth={0}
          nodeId={canvasId}
          bullet={<Bullet node={canvasNode} onClick={() => {}} />}
          content={<span className="truncate text-ui text-foreground/70">{canvasNode.text}</span>}
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          className="rounded-md border border-foreground/10 px-2 py-1 text-meta text-foreground/60 hover:bg-foreground/5"
          onClick={() => setPickerOpen(true)}
        >
          Add node
        </button>
        <span className="text-label text-foreground/30">{Math.round(zoom * 100)}%</span>
      </div>

      <div ref={stageRef} className="relative min-h-0 flex flex-1">
        <div
          className={cn(
            "kb-projection-layer relative flex min-h-0 flex-1",
            in3d && "pointer-events-none opacity-0",
          )}
          aria-hidden={in3d}
        >
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
              setItemInspectorAnchor(anchor ?? null);
            }}
            onCardChange={(card) => schedulePersist(upsertCanvasNode(docRef.current, card))}
            onResizeStart={startResize}
            onRotateStart={startRotate}
            onPortDown={startEdge}
            onWheel={onWheel}
            onPointerDownStage={onPointerDownStage}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={cancelPointer}
            onDoubleClickStage={onDoubleClickStage}
            handleCardPointerDown={(card, event, anchor) => {
              onCardPointerDown(card, event, anchor, () => startMoveForSelection(event, card.id));
            }}
            handleEdgeClick={onEdgeClick}
          />
        </div>
        {projection.mounted3d && (
          <div
            className={cn(
              "kb-projection-layer absolute inset-0",
              !in3d && "pointer-events-none opacity-0",
            )}
          >
            <Suspense fallback={null}>
              <Canvas3dStage
                key={projection.entry}
                doc={doc}
                nodes={nodes}
                selection={selection}
                rig={projection.rig}
                appearance={appearance}
                spaceDown={spaceDown}
                gizmo={gizmo}
                onReady={projection.onSceneReady}
                onError={projection.onSceneError}
                onCardPress={(card, press, startMove) =>
                  onCardPointerDown(card, press, { x: press.clientX, y: press.clientY }, startMove)
                }
                dispatchPointer={dispatchPointer}
                onTapEmpty={(world, press) => {
                  const client = { x: press.clientX, y: press.clientY };
                  if (world !== null && placeAt(world, client)) return;
                  if (press.shiftKey) return;
                  setSelection(EMPTY_SELECTION);
                  setInspectorAnchor(null);
                  setItemInspectorAnchor(null);
                }}
                onViewSettled={projection.onViewSettled}
              />
            </Suspense>
          </div>
        )}
        <CanvasViewWidget
          rig={projection.rig}
          in3d={in3d}
          flatView={projection.flatView()}
          projection={projection.target}
          selectionEmpty={selectionEmpty(selection)}
          menuOpen={viewMenuOpen}
          onMenuOpenChange={setViewMenuOpen}
          onIntent={applyIntent}
        />
        <CanvasOverlays
          projection={projection.target}
          onProjectionChange={projection.choose}
          selection={selection}
          toolState={toolState}
          selectedEdge={selectedEdgeObj}
          selectedItem={selectedItem}
          inspectorAnchor={inspectorAnchor}
          itemInspectorAnchor={itemInspectorAnchor}
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
          onCloseItemInspector={() => setItemInspectorAnchor(null)}
          onInspectItem={setItemInspectorAnchor}
          onItemChange={(shape) => schedulePersist(upsertCanvasNode(docRef.current, shape))}
          onPickNode={addKbNode}
          onClosePicker={() => setPickerOpen(false)}
          gizmo={in3d ? gizmo : null}
          onGizmoChange={setGizmo}
        />
      </div>
    </div>
  );
}
