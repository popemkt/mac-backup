/**
 * Pointer input over the 3D canvas, as canvas gestures (DESIGN-UI.md →
 * Canvas → Projections): the same ones the 2D canvas makes where they mean
 * the same. Plain state, no DOM and no three: the host feeds it presses in
 * viewport coordinates and it answers through `SceneGestureHost`.
 *
 * - On a card: a press selects it (a modifier toggles it) and a drag carries
 *   it on its own plane; with Alt, along depth. Both go through the canvas
 *   pointer reducer, so a 3D drag is the same history step and the same write
 *   as a 2D one.
 * - On empty canvas: a drag orbits, a tap places the current tool (or clears
 *   the selection).
 * - The right or middle button, or Space, pans.
 *
 * Every screen point becomes a canvas point through the one camera model, so
 * what is hit and where a card goes are the model's answers.
 */
import { canvasDepth, paintOrder, type CanvasNode } from "@kb/canvas";
import {
  hitTest,
  screenToPlane,
  type CanvasPoint,
  type CanvasPoint3,
  type CanvasView,
  type ViewSize,
} from "@/lib/canvas-camera";
import type { CanvasPointerEvent } from "@/lib/canvas-pointer";
import { pastSlop } from "@/lib/pointer-slop";

/** A press: where it is in the viewport and on screen, its button and its modifiers. */
export interface ScenePress {
  readonly local: CanvasPoint;
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
}

export interface SceneGestureHost {
  readonly view: () => CanvasView;
  readonly size: () => ViewSize;
  readonly items: () => readonly CanvasNode[];
  readonly spaceDown: () => boolean;
  /** A press on a card: select or toggle it, then `startMove` to carry it. */
  readonly cardPress: (card: CanvasNode, press: ScenePress, startMove: () => void) => void;
  readonly dispatch: (event: CanvasPointerEvent) => void;
  readonly orbit: (dx: number, dy: number) => void;
  readonly pan: (dx: number, dy: number) => void;
  /** A tap on empty canvas, at the canvas-plane point under it (null when edge-on). */
  readonly tapEmpty: (world: CanvasPoint3 | null, press: ScenePress) => void;
  /** An orbit or a pan came to rest. */
  readonly settled: () => void;
}

type Gesture =
  | { readonly kind: "card"; readonly z: number }
  | {
      readonly kind: "orbit" | "pan";
      x: number;
      y: number;
      readonly startX: number;
      readonly startY: number;
    };

/** What the pointer looks like over the scene. */
export type SceneCursor = "" | "grab" | "grabbing";

export class SceneGestures {
  private gesture: Gesture | null = null;
  private host: SceneGestureHost;

  constructor(host: SceneGestureHost) {
    this.host = host;
  }

  /** Answer through `host` from now on (the page, as it last committed). */
  bind(host: SceneGestureHost): void {
    this.host = host;
  }

  /** A press went down; whether the host should capture the pointer. */
  down(press: ScenePress): boolean {
    const pans = press.button === 1 || press.button === 2 || this.host.spaceDown();
    if (!pans && press.button !== 0) return false;
    const card = pans ? undefined : this.cardAt(press.local);
    const screen = { x: press.clientX, y: press.clientY };
    if (card !== undefined) {
      const z = canvasDepth(card);
      const world = this.planeAt(press.local, z);
      this.gesture = { kind: "card", z };
      this.host.cardPress(card, press, () => {
        if (world === null) return;
        const type = press.altKey ? "lift/start" : "move/start";
        this.host.dispatch({ type, id: card.id, screen, world });
      });
    } else {
      const kind = pans ? "pan" : "orbit";
      this.gesture = { kind, ...screen, startX: screen.x, startY: screen.y };
    }
    return true;
  }

  move(press: ScenePress): SceneCursor {
    const g = this.gesture;
    if (g === null) return this.cardAt(press.local) === undefined ? "" : "grab";
    if (g.kind === "card") {
      const world = this.planeAt(press.local, g.z);
      if (world === null) return "grabbing";
      const screen = { x: press.clientX, y: press.clientY };
      this.host.dispatch({ type: "pointer/move", screen, world, shiftKey: press.shiftKey });
      return "grabbing";
    }
    const dx = press.clientX - g.x;
    const dy = press.clientY - g.y;
    g.x = press.clientX;
    g.y = press.clientY;
    if (g.kind === "orbit") this.host.orbit(dx, dy);
    else this.host.pan(dx, dy);
    return "grabbing";
  }

  up(press: ScenePress, cancelled: boolean): void {
    const g = this.gesture;
    this.gesture = null;
    if (g === null) return;
    if (g.kind === "card") {
      if (cancelled) {
        this.host.dispatch({ type: "pointer/cancel" });
        return;
      }
      const world = this.planeAt(press.local, g.z) ?? { x: 0, y: 0, z: g.z };
      const screen = { x: press.clientX, y: press.clientY };
      this.host.dispatch({ type: "pointer/end", screen, world, shiftKey: press.shiftKey });
      return;
    }
    const tap = !pastSlop(press.clientX - g.startX, press.clientY - g.startY);
    if (g.kind === "orbit" && tap && !cancelled) {
      this.host.tapEmpty(this.planeAt(press.local, 0), press);
      return;
    }
    this.host.settled();
  }

  private cardAt(local: CanvasPoint): CanvasNode | undefined {
    const items = this.host.items();
    const id = hitTest(paintOrder(items), this.host.view(), this.host.size(), local);
    return id === null ? undefined : items.find((n) => n.id === id);
  }

  private planeAt(local: CanvasPoint, z: number): CanvasPoint3 | null {
    return screenToPlane(this.host.view(), this.host.size(), local, z);
  }
}
