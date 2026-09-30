/**
 * The 3D canvas's React host: it mounts the scene (`canvas-scene`, the only
 * part that touches three) through the scene host (`@/scene/host`), keeps it
 * given the document, the selection and the look, and turns pointer input
 * into the same gestures the 2D canvas makes (DESIGN-UI.md → Canvas →
 * Projections):
 *
 * - on a card: a press selects it (a modifier toggles it) and a drag carries
 *   it on its own plane; with Alt, a drag lifts it toward the viewer or
 *   presses it away. Both go through the canvas pointer reducer, so the
 *   result is the same history step and the same `ext.canvas.tx.apply` write
 *   as a 2D drag;
 * - on empty canvas: a drag orbits, a tap places the current tool (or clears
 *   the selection);
 * - the right or middle button, or Space, pans; the wheel pans and a pinch
 *   (or Ctrl/⌘ + wheel) zooms about the cursor, as in 2D.
 *
 * Every screen point becomes a canvas point through the one camera model, so
 * what is hit and where a card goes are the model's answers. This module is
 * the lazy chunk the canvas page imports.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { canvasDepth, paintOrder, type CanvasDoc, type CanvasNode } from "@kb/canvas";
import {
  hitTest,
  screenToPlane,
  type CanvasPoint,
  type CanvasPoint3,
  type ViewSize,
} from "@/lib/canvas-camera";
import type { CanvasCameraRig } from "@/lib/canvas-camera-rig";
import type { CanvasPointerEvent } from "@/lib/canvas-pointer";
import type { CanvasSelection } from "@/lib/canvas-selection";
import { useReducedMotion } from "@/lib/motion";
import { pastSlop } from "@/lib/pointer-slop";
import { readTiming } from "@/lib/timing";
import type { OutlineNode } from "@/lib/types";
import { attachScene } from "@/scene/host";
import { readScenePalette } from "@/scene/palette";
import type { Appearance } from "@/stores/prefs.store";
import { readCardLook } from "./canvas-card-face";
import { mountCanvasScene, type CanvasScene } from "./canvas-scene";

/** A press: where it was, and the modifiers it carried. */
type Press = Pick<
  PointerEvent,
  "clientX" | "clientY" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey"
>;

export interface Canvas3dStageProps {
  readonly doc: CanvasDoc;
  readonly nodes: Map<string, OutlineNode>;
  readonly selection: CanvasSelection;
  readonly rig: CanvasCameraRig;
  readonly appearance: Appearance;
  readonly spaceDown: boolean;
  /** The scene is drawing: the page crossfades to it. */
  readonly onReady: () => void;
  /** The scene could not start; the page stays in 2D. */
  readonly onError: (error: Error) => void;
  /** A press on a card: select or toggle it, then `startMove` to carry it. */
  readonly onCardPress: (card: CanvasNode, press: Press, startMove: () => void) => void;
  readonly dispatchPointer: (event: CanvasPointerEvent) => void;
  /** A tap on empty canvas, at the canvas-plane point under it (null when edge-on). */
  readonly onTapEmpty: (world: CanvasPoint3 | null, press: Press) => void;
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

type Gesture =
  | { kind: "card"; z: number; pointerId: number }
  | {
      kind: "orbit" | "pan";
      x: number;
      y: number;
      startX: number;
      startY: number;
      pointerId: number;
    };

function sizeOf(el: HTMLElement): ViewSize {
  return { width: el.clientWidth || 1, height: el.clientHeight || 1 };
}

function localOf(el: HTMLElement, event: { clientX: number; clientY: number }): CanvasPoint {
  const rect = el.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/** Pointer and wheel input over the host, as canvas gestures. */
function useSceneGestures(host: React.RefObject<HTMLDivElement | null>, props: Canvas3dStageProps) {
  const gesture = useRef<Gesture | null>(null);
  const cardAt = useEffectEvent((el: HTMLElement, local: CanvasPoint) =>
    hitTest(paintOrder(props.doc.nodes), props.rig.view, sizeOf(el), local),
  );
  const cardById = useEffectEvent((id: string) => props.doc.nodes.find((n) => n.id === id));
  const planeAt = useEffectEvent((el: HTMLElement, local: CanvasPoint, z: number) =>
    screenToPlane(props.rig.view, sizeOf(el), local, z),
  );
  const down = useEffectEvent((el: HTMLElement, event: PointerEvent) => {
    const local = localOf(el, event);
    const screen = { x: event.clientX, y: event.clientY };
    const pans = event.button === 1 || event.button === 2 || props.spaceDown;
    if (!pans && event.button !== 0) return;
    const id = pans ? null : cardAt(el, local);
    const card = id === null ? undefined : cardById(id);
    if (card !== undefined) {
      const z = canvasDepth(card);
      const world = planeAt(el, local, z);
      gesture.current = { kind: "card", z, pointerId: event.pointerId };
      props.onCardPress(card, event, () => {
        if (event.altKey) props.dispatchPointer({ type: "lift/start", id: card.id, screen });
        else if (world !== null) {
          props.dispatchPointer({ type: "move/start", id: card.id, screen, world });
        }
      });
    } else {
      const kind = pans ? "pan" : "orbit";
      const at = { x: event.clientX, y: event.clientY };
      gesture.current = { kind, ...at, startX: at.x, startY: at.y, pointerId: event.pointerId };
    }
    el.setPointerCapture(event.pointerId);
  });
  const move = useEffectEvent((el: HTMLElement, event: PointerEvent) => {
    const g = gesture.current;
    if (g === null) {
      el.style.cursor = cardAt(el, localOf(el, event)) === null ? "" : "grab";
      return;
    }
    if (g.kind === "card") {
      const world = planeAt(el, localOf(el, event), g.z);
      if (world === null) return;
      const screen = { x: event.clientX, y: event.clientY };
      props.dispatchPointer({ type: "pointer/move", screen, world, shiftKey: event.shiftKey });
      return;
    }
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    g.x = event.clientX;
    g.y = event.clientY;
    if (g.kind === "orbit") props.rig.orbitBy(dx, dy);
    else props.rig.panBy(dx, dy);
    el.style.cursor = "grabbing";
  });
  const up = useEffectEvent((el: HTMLElement, event: PointerEvent, cancelled: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    el.style.cursor = "";
    if (g === null) return;
    if (g.kind === "card") {
      if (cancelled) props.dispatchPointer({ type: "pointer/cancel" });
      else {
        const local = localOf(el, event);
        const world = planeAt(el, local, g.z) ?? { x: 0, y: 0, z: g.z };
        const screen = { x: event.clientX, y: event.clientY };
        props.dispatchPointer({ type: "pointer/end", screen, world, shiftKey: event.shiftKey });
      }
      return;
    }
    const tap = !pastSlop(event.clientX - g.startX, event.clientY - g.startY);
    if (g.kind === "orbit" && tap && !cancelled) {
      props.onTapEmpty(planeAt(el, localOf(el, event), 0), event);
      return;
    }
    props.onViewSettled();
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
    const onDown = (e: PointerEvent) => down(el, e);
    const onMove = (e: PointerEvent) => move(el, e);
    const onUp = (e: PointerEvent) => up(el, e, false);
    const onCancel = (e: PointerEvent) => up(el, e, true);
    const onWheel = (e: WheelEvent) => {
      wheel(el, e);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(settled, WHEEL_SETTLE_MS);
    };
    const onMenu = (e: Event) => e.preventDefault();
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", onMenu);
    return () => {
      if (timer !== null) clearTimeout(timer);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", onMenu);
    };
  }, [host]);
}

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
  useSceneGestures(host, props);

  useEffect(() => scene?.setContent({ doc, nodes, selection }), [scene, doc, nodes, selection]);
  // By the time this runs <html> carries the new appearance, so the tokens hold its values.
  useEffect(() => {
    scene?.setLook(readCardLook(), readCanvasPalette(), appearance.dark);
  }, [scene, appearance]);
  useEffect(() => scene?.setReducedMotion(reducedMotion), [scene, reducedMotion]);

  return <div ref={host} className="absolute inset-0 touch-none" data-testid="canvas-3d" />;
}
