import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { CanvasDoc, CanvasItemLink, CanvasLint, CanvasNode } from "@kb/canvas";
import {
  CANVAS_EVENTS,
  CanvasView,
  boardOf,
  canvasMembership,
  lintCanvas,
  lintDiff,
  nextPageName,
  canvasPages,
  canvasWorld,
  editItem,
  upsertCanvasEdge,
  upsertCanvasNode,
  viewpointFrames,
} from "@kb/canvas";
import {
  asElement,
  browserHost,
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
  ViewScripts,
  createViewAnchors,
  createViewEvents,
} from "@kb/ui-sdk";
import { useCanvasProjection } from "./use-canvas-projection";
import { CanvasOverlays } from "./canvas-overlays";
import { CanvasShortcutsSheet } from "./canvas-shortcuts-sheet";
import { CanvasStage } from "./canvas-stage";
import { CanvasViewWidget } from "./canvas-view-widget";
import { useCanvasDoc } from "./use-canvas-doc";
import { useCanvasPictures } from "./use-canvas-pictures";
import { CanvasFaceEditor } from "./canvas-face-editor";
import { useFaceEditing } from "./use-face-editing";
import { createCanvasEdgeActions } from "./use-canvas-edge-actions";
import { useCanvasGestures } from "./use-canvas-gestures";
import { useCanvasKeyboard } from "./use-canvas-keyboard";
import { useCanvasScreen } from "./use-canvas-screen";
import { CanvasScriptAnchors } from "./canvas-script-anchors";
import { useCanvasCapture } from "./canvas-capture";
import { useCanvasSelection } from "./use-canvas-selection";
import { createCanvasNode, listRefFields } from "./canvas-api";
import { CANVAS_LIST_PATH, canvasPath } from "./routes";
import { CanvasPageStrip, type CanvasPageTab } from "./canvas-page-strip";
import { linkStep } from "./canvas-links";
import { classifyCardPointer } from "./card-pointer";
import { placesItem, pressPans, type CanvasChooser, type ToolState } from "./canvas-tool";
import type { PresentAct } from "./canvas-keymap";
import { FIRST_GIZMO, type GizmoChoice } from "./canvas-gizmo";
import { viewOfPan } from "./canvas-camera";
import { placeUnder } from "./canvas-faces";
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

/** A lint as a script is told it: plain data. */
const told = ({ rule, ids, message }: CanvasLint) => ({ rule, ids: [...ids], message });

/** Open page `id` of a board, as its tab does. */
const openPage = (id: string) => navigate(canvasPath({ id }));

interface CanvasPageProps {
  canvasId: string;
  /** An item to show and select as the canvas opens: where a link to it leads. */
  item?: string;
}

export function CanvasPage({ canvasId, item: arrival }: CanvasPageProps) {
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const panning = pressPans(toolState, spaceDown);
  const [editingEdgeLabel, setEditingEdgeLabel] = useState<string | null>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [gizmo, setGizmo] = useState<GizmoChoice>(FIRST_GIZMO);
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
  /** The events the canvas tells its scripts (`CANVAS_EVENTS`), on one channel for its life. */
  const [scriptEvents] = useState(createViewEvents);
  const [scriptAnchors] = useState(createViewAnchors);
  /** An item pressed, in either projection: the scripts hear it, then the press does what it does. */
  const pressCard: typeof onCardPointerDown = (card, ...rest) => {
    scriptEvents.emit({
      type: CANVAS_EVENTS.itemClick,
      target: card.id,
      value: { canvas: canvasId },
    });
    onCardPointerDown(card, ...rest);
  };

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
  /** Where the pointer last was over the canvas, or the middle of it. */
  const pointerAt = () => {
    const { size } = projection.camera();
    return lastPointer.current ?? { x: size.width / 2, y: size.height / 2 };
  };
  const pictures = useCanvasPictures({
    docRef,
    schedulePersist,
    setSelection,
    upload: (file) => browserHost().writes.uploadAsset(file),
    camera: projection.camera,
    pointerAt,
    placementPoint: projection.placementPoint,
    stage: stageRef,
  });
  const faces = useFaceEditing({
    byId,
    in3d,
    rig: projection.rig,
    size: () => projection.camera().size,
    settled: projection.onViewSettled,
    select: (id) => setSelection(selNode(id)),
    enter,
  });
  /** What a tool placed with something chosen first opens: a card's node picker, an image's file chooser. */
  const choose = (chooser: CanvasChooser) => {
    const opens: Record<CanvasChooser, () => void> = {
      node: () => setPickerOpen(true),
      file: pictures.choose,
    };
    opens[chooser]();
  };
  const {
    addKbNode,
    onDoubleClickStage,
    onModalPress,
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
    panning,
    toolState,
    dispatchPointer,
    schedulePersist,
    flushPersist,
    setInspectorAnchor,
    setPickerOpen,
    choose,
    edit: (id) => faces.onEdit(id, true),
    setSelection,
    setItemInspectorAnchor,
    setToolState,
    setZoom,
  });

  const cancelPointer = useCallback(() => {
    dispatchPointer({ type: "pointer/cancel" });
  }, [dispatchPointer]);

  const viewport = projection.viewportOf(viewportControls);
  const drawing = useCanvasCapture(projection.holdScene);
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
    camera: projection.camera,
    viewport,
    capture: drawing.capture,
  });
  /** What the canvas reads of kb around it: where its links lead. */
  const world = useMemo(() => canvasWorld(nodes.values()), [nodes]);
  const board = boardOf(world, canvasId);
  /** The nodes whose scripts run here: the board's, across its pages, and this page's. */
  const scripted = useMemo(
    () => (board === canvasId ? [canvasId] : [board, canvasId]),
    [board, canvasId],
  );
  useEffect(() => {
    scriptEvents.emit({
      type: CANVAS_EVENTS.selection,
      target: null,
      value: { canvas: canvasId, items: [...selection.nodeIds], edges: [...selection.edgeIds] },
    });
  }, [scriptEvents, canvasId, selection]);
  useEffect(() => {
    scriptEvents.emit({ type: CANVAS_EVENTS.page, target: canvasId, value: { board } });
  }, [scriptEvents, canvasId, board]);
  /** The lints of the document the scripts last heard about, so a change says what it made and cleared. */
  const heardLints = useRef<{
    readonly canvas: string;
    readonly doc: CanvasDoc;
    readonly lints: CanvasLint[];
  } | null>(null);
  useEffect(() => {
    const before = heardLints.current;
    // The world moving under the same document is no change to it.
    if (before?.canvas === canvasId && before.doc === doc) return;
    const lints = lintCanvas(canvasId, doc, world);
    heardLints.current = { canvas: canvasId, doc, lints };
    // The first document of a page is where it stands, not a change.
    if (before?.canvas !== canvasId) return;
    const { new: made, resolved } = lintDiff(before.lints, lints);
    scriptEvents.emit({
      type: CANVAS_EVENTS.change,
      target: null,
      value: { canvas: canvasId, lints: { new: made.map(told), resolved: resolved.map(told) } },
    });
  }, [scriptEvents, canvasId, doc, world]);
  /** An item on this canvas shown and selected; nothing when it is not on it. */
  const showItem = (id: string) => {
    const shown = byId.get(id);
    if (shown === undefined) return;
    setSelection(selNode(id));
    viewport.frame([shown]);
  };
  // GAP [[01M546BF0GJ09QQV8H747X0JM7]] an item's link shows no mark on the canvas; it is followed from the inspector or ⌘↵
  /** Go where `link` leads: out of kb, to another page, or to an item here. */
  const follow = (link: CanvasItemLink) => {
    const step = linkStep(link, canvasId, world);
    if (step === null) return;
    if (step.kind === "web") window.open(step.url, "_blank", "noopener,noreferrer");
    else if (step.kind === "path") navigate(step.path);
    else showItem(step.item);
  };
  /** The pages of the board this canvas is on, each by its node's text (`canvasPages`). */
  const pages = useMemo<CanvasPageTab[]>(
    () =>
      canvasPages(world, canvasId).map((id) => {
        const text = world.textOf(id);
        return { id, label: text === undefined || text === "" ? "Untitled page" : text };
      }),
    [world, canvasId],
  );
  /** The page `step` on from this one; none past either end. */
  const turnPage = (step: 1 | -1) => {
    const next = pages[pages.findIndex((page) => page.id === canvasId) + step];
    if (next !== undefined) openPage(next.id);
  };
  /** Whether a new page is being made: a second press waits for it rather than making another. */
  const makingPage = useRef(false);
  /** A new page: a canvas under the board, named by the next free name, opened. */
  const newPage = async () => {
    if (makingPage.current) return;
    makingPage.current = true;
    try {
      const name = nextPageName(pages.map((page) => page.label));
      const id = await createCanvasNode(name, boardOf(world, canvasId));
      if (id !== null) openPage(id);
    } finally {
      makingPage.current = false;
    }
  };
  /** The item the route names, shown once as the canvas opens with it on. */
  const arrived = useRef<string | null>(null);
  useEffect(() => {
    if (arrival === undefined || !byId.has(arrival)) return;
    const at = `${canvasId}/${arrival}`;
    if (arrived.current === at) return;
    arrived.current = at;
    showItem(arrival);
  });
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
    pointerAt,
    pastePictures: pictures.paste,
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
    openShortcuts: () => setShortcutsOpen(true),
    follow,
    turnPage,
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
      <NotFound
        what="Canvas"
        id={canvasId}
        back={{ label: "All canvases", path: CANVAS_LIST_PATH }}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-foreground/[0.06] px-3">
        <button
          type="button"
          className="text-meta text-foreground/40 hover:text-foreground/70"
          onClick={() => navigate(CANVAS_LIST_PATH)}
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

      <CanvasPageStrip
        pages={pages}
        current={canvasId}
        onOpen={openPage}
        onNew={() => void newPage()}
      />

      <div
        ref={stageRef}
        className="relative min-h-0 flex flex-1"
        onDragOver={pictures.onDragOver}
        onDrop={pictures.onDrop}
      >
        <div
          className={cn(
            "kb-projection-layer relative flex min-h-0 flex-1",
            in3d && "pointer-events-none opacity-0",
          )}
          aria-hidden={in3d}
          onPointerDownCapture={(e) => {
            if (modal || e.button !== 0 || panning || e.altKey) return;
            const card = byId.get(cardIdAt(e.target) ?? "");
            // A press on empty canvas steps out of the group entered.
            if (card === undefined) {
              if (!e.shiftKey) setScope(null);
              return;
            }
            // A placing tool places inside a frame: on its face, or the floor under it (`placeUnder`).
            const viewportEl = e.currentTarget.querySelector<HTMLElement>("[data-canvas-viewport]");
            const client = { x: e.clientX, y: e.clientY };
            const rect = viewportEl?.getBoundingClientRect();
            const { view, size } = projection.camera();
            const local = { x: client.x - (rect?.left ?? 0), y: client.y - (rect?.top ?? 0) };
            const place = placeUnder(view, size, local, card);
            if (
              membership.isGroup(card.id) &&
              place !== null &&
              placeAt(place.at, client, place.face)
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
            pressCard(card, e, undefined, (id) => startMoveForSelection(e, id));
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
            panning={panning}
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
              pressCard(card, event, anchor, (id) => startMoveForSelection(event, id));
            }}
            handleEdgeClick={onEdgeClick}
            editing={faces.flat}
            onEdit={faces.onEdit}
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
                panning={panning}
                placing={placesItem(toolState.tool)}
                transforming={modal}
                gizmo={gizmo}
                onReady={projection.onSceneReady}
                onError={projection.onSceneError}
                onPainter={drawing.onPainter}
                onCardPress={(card, press, startMove) =>
                  pressCard(card, press, { x: press.clientX, y: press.clientY }, startMove)
                }
                onCardDoubleClick={faces.doubleClick}
                dispatchPointer={dispatchPointer}
                onTapEmpty={(place, press) => {
                  const client = { x: press.clientX, y: press.clientY };
                  if (place !== null && placeAt(place.at, client, place.face)) return;
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
        <CanvasFaceEditor
          item={faces.deep}
          rig={projection.rig}
          size={() => projection.camera().size}
          onEdit={faces.onEdit}
          onChange={(item) => schedulePersist(upsertCanvasNode(docRef.current, item))}
        />
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
        <CanvasShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <CanvasScriptAnchors
          rig={projection.rig}
          in3d={in3d}
          flatView={projection.flatView()}
          width={projection.camera().size.width}
          height={projection.camera().size.height}
          items={doc.nodes}
          anchors={scriptAnchors}
        />
        <ViewScripts
          subjects={scripted}
          view={CanvasView}
          events={scriptEvents}
          anchors={scriptAnchors}
        />
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
          onBringToFront={() => applyIntent({ type: "order", order: "front" })}
          onSendToBack={() => applyIntent({ type: "order", order: "back" })}
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
          world={world}
          pages={pages.filter((page) => page.id !== canvasId)}
          onFollowLink={follow}
          onPickNode={addKbNode}
          onClosePicker={() => setPickerOpen(false)}
          gizmo={in3d ? gizmo : null}
          onGizmoChange={setGizmo}
        />
      </div>
    </div>
  );
}
