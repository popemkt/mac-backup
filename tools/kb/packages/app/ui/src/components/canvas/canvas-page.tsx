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
import {
  canvasMembership,
  editItem,
  upsertCanvasEdge,
  upsertCanvasNode,
  viewpointFrames,
} from "@kb/canvas";
import {
  asElement,
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
import { classifyCardPointer } from "./card-pointer";
import { placesItem, type CanvasChooser, type ToolState } from "./canvas-tool";
import type { PresentAct } from "./canvas-keymap";
import { FIRST_GIZMO, type GizmoChoice } from "./canvas-gizmo";
import { viewOfPan } from "./canvas-camera";
import type { TransformCamera } from "./canvas-transform-input";
import { CanvasTransformGuides } from "./canvas-transform-guides";
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
  type Point,
  type PointerResult,
  type PointerState,
} from "./canvas-pointer";

/** The 3D projection's chunk: three loads only when a canvas is looked at in depth. */
const Canvas3dStage = lazy(() => import("./canvas-3d-stage"));

/** The id of the item a DOM event landed on, in the 2D stage. */
function cardIdAt(target: EventTarget | null): string | undefined {
  return asElement(target)?.closest<HTMLElement>("[data-card-id]")?.dataset.cardId;
}

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
  /** What a tool placed with something chosen first opens: a card's node picker. */
  const choose = useCallback((chooser: CanvasChooser) => {
    const opens: Record<CanvasChooser, () => void> = { node: () => setPickerOpen(true) };
    opens[chooser]();
  }, []);
  const [toolState, setToolState] = useState<ToolState>({ tool: "select" });
  const [editingEdgeLabel, setEditingEdgeLabel] = useState<string | null>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [gizmo, setGizmo] = useState<GizmoChoice>(FIRST_GIZMO);
  /** The item whose editor is open, in whichever projection shows it; null when none is. */
  const [editing, setEditing] = useState<string | null>(null);
  /** An item's editor opened, or closed (and any other item's stays as it is). */
  const onEdit = useCallback((id: string, on: boolean) => {
    setEditing((current) => (on ? id : current === id ? null : current));
  }, []);
  /** The frame present mode stands at, by id, so a frame added or taken away elsewhere moves no slide; null when not presenting. */
  const [presentId, setPresentId] = useState<string | null>(null);

  const byId = useMemo(() => {
    const m = new Map<string, CanvasNode>();
    for (const n of doc.nodes) m.set(n.id, n);
    return m;
  }, [doc.nodes]);
  const membership = useMemo(() => canvasMembership(doc.nodes), [doc.nodes]);
  /** The frames the canvas is seen through: "go to frame" and present mode's slides. */
  const frames = useMemo(() => viewpointFrames(doc.nodes, membership), [doc.nodes, membership]);
  const presentIndex = frames.findIndex((frame) => frame.id === presentId);
  const presenting = presentIndex < 0 ? null : presentIndex;
  // The frame presented is gone: present mode ends, and nothing later brings it back.
  if (presentId !== null && presenting === null) setPresentId(null);

  const {
    enter,
    inspectorAnchor,
    leave,
    onCardPointerDown,
    onEdgeClick,
    pressReaches,
    scope,
    selectedEdge: selectedEdgeObj,
    selectedItem,
    selection,
    selectionRef: selRef,
    setInspectorAnchor,
    setScope,
    setSelection,
    setItemInspectorAnchor,
    itemInspectorAnchor,
  } = useCanvasSelection(doc, byId, membership);

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

  /** Where the pointer last was over either projection: where a modal transform begins. */
  const lastPointer = useRef<Point | null>(null);
  const dispatchPointer = useCallback(
    (event: CanvasPointerEvent): PointerResult => {
      if ("screen" in event) lastPointer.current = event.screen;
      const next = pointerReduce(pointerRef.current, event, {
        doc: docRef.current,
        membership,
        selection: selRef.current,
        scope,
        byId,
        ...cameraRef.current(),
      });
      applyPointerResult(next);
      return next;
    },
    [applyPointerResult, byId, docRef, membership, scope, selRef],
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
    onModalPress,
    onPointerDownStage,
    onPointerMove,
    onPointerUp,
    onWheel,
    placeAt,
    screenToWorld,
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
    choose,
    setSelection,
    setItemInspectorAnchor,
    setToolState,
    setZoom,
  });

  const cancelPointer = useCallback(() => {
    dispatchPointer({ type: "pointer/cancel" });
  }, [dispatchPointer]);

  const viewport = projection.viewportOf(viewportControls);
  const modal = pointerState.drag?.kind === "transform" && pointerState.drag.modal;
  const modalDrag = modal ? pointerState.drag : null;
  /** Present mode steps through the frames, flying to each face-on; past either end it stays. */
  const present = (act: PresentAct) => {
    const step = act === "next" ? 1 : act === "previous" ? -1 : 0;
    const at =
      act === "start" ? 0 : Math.max(0, Math.min(frames.length - 1, (presenting ?? 0) + step));
    const frame = act === "stop" ? undefined : frames[at];
    setPresentId(frame?.id ?? null);
    if (frame !== undefined) viewport.faceOn(frame);
  };
  const applyIntent = useCanvasKeyboard({
    cancelPointer,
    dispatchPointer,
    pointerAt: () => {
      const { size } = projection.camera();
      return lastPointer.current ?? { x: size.width / 2, y: size.height / 2 };
    },
    transforming: () => {
      const drag = pointerRef.current.drag;
      return drag?.kind === "transform" && drag.modal;
    },
    presenting: () => presenting !== null,
    present,
    toolArmed: toolState.tool !== "select",
    scope,
    leaveScope: leave,
    byId,
    docRef,
    selRef,
    schedulePersist,
    undoCanvasDoc,
    redoCanvasDoc,
    setSelection,
    setInspectorAnchor,
    setItemInspectorAnchor,
    choose,
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
          onPointerDownCapture={(e) => {
            if (modal || e.button !== 0 || spaceDown || e.altKey) return;
            const card = byId.get(cardIdAt(e.target) ?? "");
            // A press on empty canvas steps out of the group entered.
            if (card === undefined) {
              if (!e.shiftKey) setScope(null);
              return;
            }
            // A placing tool sees through a frame to the floor: it places inside it.
            const viewportEl = e.currentTarget.querySelector<HTMLElement>("[data-canvas-viewport]");
            const client = { x: e.clientX, y: e.clientY };
            if (
              membership.isGroup(card.id) &&
              viewportEl !== null &&
              placeAt(screenToWorld(client.x, client.y, viewportEl), client)
            ) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            // Its ports are the card's own: an edge may start from a member of any group.
            if (classifyCardPointer(e.target, undefined) === "chrome") return;
            // A member of a group not entered is part of its group: its own editor never takes the press.
            if (pressReaches(card)) return;
            e.preventDefault();
            e.stopPropagation();
            onCardPointerDown(card, e, undefined, (id) => startMoveForSelection(e, id));
          }}
          onDoubleClickCapture={(e) => {
            const card = byId.get(cardIdAt(e.target) ?? "");
            if (modal || card === undefined || !enter(card)) return;
            e.preventDefault();
            e.stopPropagation();
          }}
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
            onModalPress={onModalPress}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={cancelPointer}
            onDoubleClickStage={onDoubleClickStage}
            handleCardPointerDown={(card, event, anchor) => {
              onCardPointerDown(card, event, anchor, (id) => startMoveForSelection(event, id));
            }}
            handleEdgeClick={onEdgeClick}
            editing={editing}
            onEdit={onEdit}
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
                placing={placesItem(toolState.tool)}
                transforming={modal}
                gizmo={gizmo}
                onReady={projection.onSceneReady}
                onError={projection.onSceneError}
                onCardPress={(card, press, startMove) =>
                  onCardPointerDown(card, press, { x: press.clientX, y: press.clientY }, startMove)
                }
                onCardDoubleClick={enter}
                dispatchPointer={dispatchPointer}
                onTapEmpty={(world, press) => {
                  const client = { x: press.clientX, y: press.clientY };
                  if (world !== null && placeAt(world, client)) return;
                  if (press.shiftKey) return;
                  setScope(null);
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
          frames={frames}
          menuOpen={viewMenuOpen}
          onMenuOpenChange={setViewMenuOpen}
          onIntent={applyIntent}
        />
        {modalDrag?.kind === "transform" && modalDrag.input !== null && (
          <CanvasTransformGuides
            input={modalDrag.input}
            applied={modalDrag.applied}
            rig={projection.rig}
            in3d={in3d}
            flatView={projection.flatView()}
            size={projection.camera().size}
          />
        )}
        <CanvasOverlays
          transforming={modal}
          scope={scope === null ? null : (byId.get(scope) ?? null)}
          onLeaveScope={leave}
          presenting={
            presenting === null
              ? null
              : { at: presenting, frames: frames.length, frame: frames[presenting] }
          }
          onPresent={present}
          onGroup={() => applyIntent({ type: "group" })}
          onUngroup={() => applyIntent({ type: "ungroup" })}
          canUngroup={[...selection.nodeIds].some((id) => membership.isGroup(id))}
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
          onItemChange={(item) => schedulePersist(editItem(docRef.current, item))}
          onPickNode={addKbNode}
          onClosePicker={() => setPickerOpen(false)}
          gizmo={in3d ? gizmo : null}
          onGizmoChange={setGizmo}
        />
      </div>
    </div>
  );
}
