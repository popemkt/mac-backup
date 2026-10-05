/**
 * The 3D canvas's React host: it mounts the scene (`canvas-scene`, the only
 * part that touches three) through the scene host (`@kb/scene`'s `attachScene`), keeps it
 * given the document, the selection and the look, and feeds pointer input to
 * the scene's gestures (`canvas-scene-gestures`); the wheel pans and a pinch
 * (or Ctrl/⌘ + wheel) zooms about the cursor, as in 2D. This module is the
 * lazy chunk the canvas page imports.
 */
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { CanvasDoc, CanvasNode } from "@kb/canvas";
import type { CanvasPoint, ViewSize } from "./canvas-camera";
import type { CanvasPainter } from "./canvas-capture";
import type { CanvasPlace } from "./canvas-faces";
import type { CanvasCameraRig } from "./canvas-camera-rig";
import type { CanvasPointerEvent } from "./canvas-pointer";
import type { CanvasSelection } from "./canvas-selection";
import { NO_GIZMO, type GizmoChoice } from "./canvas-gizmo";
import { readTiming, useReducedMotion, type Appearance, type OutlineNode } from "@kb/ui-sdk";
import { attachScene, readScenePalette } from "@kb/scene";
import { readCardLook } from "./canvas-card-face";
import { mountCanvasScene, type CanvasScene } from "./canvas-scene";
import { SceneGestures, type SceneGestureHost, type ScenePress } from "./canvas-scene-gestures";

export interface Canvas3dStageProps {
  readonly doc: CanvasDoc;
  readonly nodes: Map<string, OutlineNode>;
  readonly selection: CanvasSelection;
  readonly rig: CanvasCameraRig;
  readonly appearance: Appearance;
  readonly spaceDown: boolean;
  /** A tool that places an item is active: it sees through frames to the floor. */
  readonly placing: boolean;
  /** A modal transform (G, S, E) is under way: a press ends it. */
  readonly transforming: boolean;
  /** Which transform the gizmo on the selection shows, and along which axes. */
  readonly gizmo: GizmoChoice;
  /** The scene is drawing: the page crossfades to it. */
  readonly onReady: () => void;
  /** The scene could not start; the page stays in 2D. */
  readonly onError: (error: Error) => void;
  /** The mounted scene, which draws pictures, as it comes and goes (null once it has gone). */
  readonly onPainter: (painter: CanvasPainter | null) => void;
  /** A press on a card: select or toggle what it reaches, then `startMove` to carry that. */
  readonly onCardPress: (
    card: CanvasNode,
    press: ScenePress,
    startMove: (id: string) => void,
  ) => void;
  /** A double-click on a card: into the group on the way to it (whether it went). */
  readonly onCardDoubleClick: (card: CanvasNode) => boolean;
  readonly dispatchPointer: (event: CanvasPointerEvent) => void;
  /** A tap on empty canvas, or with a placing tool on a frame: where a tool would place there. */
  readonly onTapEmpty: (place: CanvasPlace | null, press: ScenePress) => void;
  /** An orbit, a pan or a zoom came to rest. */
  readonly onViewSettled: () => void;
}

/**
 * The 3D canvas's palette roles. The ground is the page's, edge to edge, as
 * the 2D canvas's is: the crossfade between them is between equal grounds,
 * and depth is told by the cards' shadows and the grid, not by a vignette.
 */
function readCanvasPalette() {
  return readScenePalette({
    ground: "--background",
    edge: "--background",
    hue: "--muted-foreground",
    ink: "--foreground",
    accent: "--primary",
  });
}

/** How long a wheel must be still before the view counts as settled, ms. */
const WHEEL_SETTLE_MS = 260;

function sizeOf(el: HTMLElement): ViewSize {
  return { width: el.clientWidth || 1, height: el.clientHeight || 1 };
}

function localOf(el: HTMLElement, event: { clientX: number; clientY: number }): CanvasPoint {
  const rect = el.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function pressOf(el: HTMLElement, event: MouseEvent): ScenePress {
  return {
    local: localOf(el, event),
    clientX: event.clientX,
    clientY: event.clientY,
    button: event.button,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
  };
}

/** Pointer and wheel input over the host, as the scene's gestures. */
function useSceneGestures(
  host: React.RefObject<HTMLDivElement | null>,
  props: Canvas3dStageProps,
  scene: CanvasScene | null,
) {
  const [gestures] = useState(() => new SceneGestures(IDLE));
  // The gestures read the page as it last committed.
  useLayoutEffect(() => {
    const el = host.current;
    gestures.bind({
      view: () => props.rig.view,
      size: () => (el === null ? { width: 1, height: 1 } : sizeOf(el)),
      items: () => props.doc.nodes,
      selection: () => props.selection,
      spaceDown: () => props.spaceDown,
      placing: () => props.placing,
      transforming: () => props.transforming,
      gizmo: () => scene?.gizmo ?? NO_GIZMO,
      cardPress: props.onCardPress,
      cardDoubleClick: props.onCardDoubleClick,
      dispatch: props.dispatchPointer,
      orbit: (dx, dy) => props.rig.orbitBy(dx, dy),
      pan: (dx, dy) => props.rig.panBy(dx, dy),
      tapEmpty: props.onTapEmpty,
      settled: props.onViewSettled,
    });
  });
  const wheel = useEffectEvent((el: HTMLElement, event: WheelEvent) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      props.rig.zoomAt(event.deltaY > 0 ? 0.92 : 1.08, localOf(el, event), sizeOf(el));
    } else props.rig.panBy(-event.deltaX, -event.deltaY);
  });
  const settled = useEffectEvent(() => props.onViewSettled());

  useEffect(() => {
    const el = host.current;
    if (el === null) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onDown = (e: PointerEvent) => {
      if (gestures.down(pressOf(el, e))) el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      el.style.cursor = gestures.move(pressOf(el, e));
    };
    const end = (e: PointerEvent, cancelled: boolean) => {
      gestures.up(pressOf(el, e), cancelled);
      el.style.cursor = "";
    };
    const onUp = (e: PointerEvent) => end(e, false);
    const onCancel = (e: PointerEvent) => end(e, true);
    const onWheel = (e: WheelEvent) => {
      wheel(el, e);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(settled, WHEEL_SETTLE_MS);
    };
    const onMenu = (e: Event) => e.preventDefault();
    const onDoubleClick = (e: MouseEvent) => gestures.doubleClick(pressOf(el, e));
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("dblclick", onDoubleClick);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", onMenu);
    return () => {
      if (timer !== null) clearTimeout(timer);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("dblclick", onDoubleClick);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", onMenu);
    };
  }, [host, gestures]);
}

/** Before the host has committed there is nothing to hit or tell. */
const IDLE: SceneGestureHost = {
  view: () => ({ x: 0, y: 0, z: 0, zoom: 1, yaw: 0, pitch: 0, fov: 0 }),
  size: () => ({ width: 1, height: 1 }),
  items: () => [],
  selection: () => ({ nodeIds: new Set(), edgeIds: new Set() }),
  spaceDown: () => false,
  placing: () => false,
  transforming: () => false,
  gizmo: () => NO_GIZMO,
  cardPress: () => {},
  cardDoubleClick: () => false,
  dispatch: () => {},
  orbit: () => {},
  pan: () => {},
  tapEmpty: () => {},
  settled: () => {},
};

type InspectableHost = HTMLDivElement & { __kbCanvas3d?: CanvasScene };

/** Mount one scene while this host lives, started from the latest props. */
function useMountedScene(
  host: React.RefObject<HTMLDivElement | null>,
  props: Canvas3dStageProps,
  reducedMotion: boolean,
  onMounted: (scene: CanvasScene | null) => void,
): void {
  const start = useEffectEvent((el: HTMLElement) =>
    mountCanvasScene(el, {
      rig: props.rig,
      content: { doc: props.doc, nodes: props.nodes, selection: props.selection },
      look: readCardLook(),
      palette: readCanvasPalette(),
      dark: props.appearance.dark,
      timing: readTiming(),
      reducedMotion,
      gizmo: props.gizmo,
    }),
  );
  const ready = useEffectEvent(() => props.onReady());
  const failed = useEffectEvent((error: Error) => props.onError(error));
  useEffect(() => {
    const el = host.current;
    if (el === null) return undefined;
    const detach = attachScene(el, start(el), {
      onReady: (scene) => {
        if (import.meta.env.MODE === "test-render") (el as InspectableHost).__kbCanvas3d = scene;
        onMounted(scene);
        ready();
      },
      onError: failed,
    });
    return () => {
      detach();
      delete (el as InspectableHost).__kbCanvas3d;
      onMounted(null);
    };
  }, [host, onMounted]);
}

export default function Canvas3dStage(props: Canvas3dStageProps) {
  const { doc, nodes, selection, appearance } = props;
  const host = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [scene, setScene] = useState<CanvasScene | null>(null);
  useMountedScene(host, props, reducedMotion, setScene);
  useSceneGestures(host, props, scene);
  const painted = useEffectEvent((painter: CanvasPainter | null) => props.onPainter(painter));
  useEffect(() => {
    painted(scene);
    return () => painted(null);
  }, [scene]);

  useEffect(() => scene?.setContent({ doc, nodes, selection }), [scene, doc, nodes, selection]);
  useEffect(() => scene?.setGizmo(props.gizmo), [scene, props.gizmo]);
  // By the time this runs <html> carries the new appearance, so the tokens hold its values.
  useEffect(() => {
    scene?.setLook(readCardLook(), readCanvasPalette(), appearance.dark);
  }, [scene, appearance]);
  useEffect(() => scene?.setReducedMotion(reducedMotion), [scene, reducedMotion]);

  return <div ref={host} className="absolute inset-0 touch-none" data-testid="canvas-3d" />;
}
