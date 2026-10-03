/**
 * Pointer input over the 3D canvas, as canvas gestures (DESIGN-UI.md →
 * Canvas → Projections): the same ones the 2D canvas makes where they mean
 * the same. Plain state, no DOM and no three: the host feeds it presses in
 * viewport coordinates and it answers through `SceneGestureHost`.
 *
 * - On a handle of the gizmo (`canvas-gizmo`), which stands on the
 *   selection: a drag moves, turns or scales the selection, as one transform
 *   the pointer reducer previews and writes on release. The gizmo is asked
 *   first, so its handles take the pointer over whatever is behind them.
 * - On an item: a press selects it (a modifier toggles it) and a drag carries
 *   it across the floor plan; with Alt, held to Z. Both go through the canvas
 *   pointer reducer, which reads the pointer through the camera model, so a
 *   3D drag is the same transform, history step and write as a 2D one.
 * - On empty canvas: a drag orbits, a tap places the current tool (or clears
 *   the selection).
 * - The right or middle button, or Space, pans.
 */
import { paintOrder, type CanvasNode } from "@kb/canvas";
import {
  hitTest,
  screenToPlane,
  type CanvasPoint,
  type CanvasPoint3,
  type CanvasView,
  type ViewSize,
} from "./canvas-camera";
import type { CanvasPointerEvent } from "./canvas-pointer";
import { ALONG_Z } from "./canvas-transform-input";
import type { SceneGizmo } from "./canvas-gizmo";
import type { CanvasSelection } from "./canvas-selection";
import { pastSlop } from "@/sdk";

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
  readonly selection: () => CanvasSelection;
  readonly spaceDown: () => boolean;
  /** A modal transform (G, S, E) is under way. */
  readonly transforming: () => boolean;
  /** The gizmo on the selection. */
  readonly gizmo: () => SceneGizmo;
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
  | { readonly kind: "gizmo" }
  | { readonly kind: "card" }
  | {
      readonly kind: "orbit" | "pan";
      x: number;
      y: number;
      readonly startX: number;
      readonly startY: number;
    };

/** ⌘ or Ctrl held: every snap suspended. */
const freeOf = (press: ScenePress) => press.metaKey || press.ctrlKey;

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
    if (this.host.transforming()) {
      // A press only ends a modal transform: the left button confirms, any other cancels.
      this.host.dispatch(
        press.button === 0 ? { type: "transform/confirm" } : { type: "pointer/cancel" },
      );
      return false;
    }
    const pans = press.button === 1 || press.button === 2 || this.host.spaceDown();
    if (!pans && press.button !== 0) return false;
    if (!pans && this.host.gizmo().press(press.local)) {
      this.gesture = { kind: "gizmo" };
      this.host.dispatch({ type: "transform/start" });
      return true;
    }
    const card = pans ? undefined : this.cardAt(press.local);
    if (card !== undefined) {
      this.gesture = { kind: "card" };
      this.host.cardPress(card, press, () => {
        const along = press.altKey ? { along: ALONG_Z } : {};
        this.host.dispatch({ type: "move/start", id: card.id, screen: press.local, ...along });
      });
    } else {
      // Owner answer 4 of the 3D workspace plan: Shift-drag here is a
      // screen-space marquee. Today every empty-space drag orbits.
      // GAP [[01M41AB88FH1G58NR7AZE0SZJF]]
      const kind = pans ? "pan" : "orbit";
      const screen = { x: press.clientX, y: press.clientY };
      this.gesture = { kind, ...screen, startX: screen.x, startY: screen.y };
    }
    return true;
  }

  move(press: ScenePress): SceneCursor {
    const g = this.gesture;
    const { shiftKey } = press;
    const free = freeOf(press);
    if (g === null) {
      // With no button held the pointer still counts: a modal transform follows it.
      this.host.dispatch({ type: "pointer/move", screen: press.local, shiftKey, free });
      if (this.host.transforming()) return "grabbing";
      if (this.host.gizmo().hover(press.local)) return "grab";
      return this.cardAt(press.local) === undefined ? "" : "grab";
    }
    if (g.kind === "gizmo") {
      const transform = this.host.gizmo().drag(press.local);
      if (transform !== null) this.host.dispatch({ type: "transform/move", transform, free });
      return "grabbing";
    }
    if (g.kind === "card") {
      this.host.dispatch({ type: "pointer/move", screen: press.local, shiftKey, free });
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
    if (g.kind === "gizmo" || g.kind === "card") {
      if (g.kind === "gizmo") this.host.gizmo().release();
      const { shiftKey } = press;
      this.host.dispatch(
        cancelled
          ? { type: "pointer/cancel" }
          : { type: "pointer/end", screen: press.local, shiftKey, free: freeOf(press) },
      );
      return;
    }
    const tap = !pastSlop(press.clientX - g.startX, press.clientY - g.startY);
    // A tap moved no camera: on empty canvas it means the tool or the selection.
    if (tap) {
      if (g.kind === "orbit" && !cancelled) {
        this.host.tapEmpty(
          screenToPlane(this.host.view(), this.host.size(), press.local, 0),
          press,
        );
      }
      return;
    }
    this.host.settled();
  }

  private cardAt(local: CanvasPoint): CanvasNode | undefined {
    const items = this.host.items();
    const id = hitTest(paintOrder(items), this.host.view(), this.host.size(), local);
    return id === null ? undefined : items.find((n) => n.id === id);
  }
}
