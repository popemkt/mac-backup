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
 *   it on its own plane; with Alt, up from the floor. Both go through the canvas
 *   pointer reducer, so a 3D drag is the same history step and the same write
 *   as a 2D one.
 * - On empty canvas: a drag orbits, a tap places the current tool (or clears
 *   the selection).
 * - The right or middle button, or Space, pans.
 *
 * Every screen point becomes a canvas point through the one camera model, so
 * what is hit and where a card goes are the model's answers.
 */
import { canvasDepth, canvasTop, paintOrder, type CanvasNode } from "@kb/canvas";
import {
  coversFromAbove,
  hitTest,
  screenToPlane,
  type CanvasPoint,
  type CanvasPoint3,
  type CanvasView,
  type ViewSize,
} from "./canvas-camera";
import { carriedIds, type CanvasPointerEvent } from "./canvas-pointer";
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
  | {
      readonly kind: "card";
      readonly z: number;
      /** The items the drag carries, which the pointer is never read on. */
      readonly carried: ReadonlySet<string>;
      /** The last canvas point the drag had on the card's plane (none while edge-on). */
      last: CanvasPoint3 | null;
    }
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
    const screen = { x: press.clientX, y: press.clientY };
    if (!pans && this.host.gizmo().press(press.local)) {
      this.gesture = { kind: "gizmo" };
      this.host.dispatch({ type: "transform/start" });
      return true;
    }
    const card = pans ? undefined : this.cardAt(press.local);
    if (card !== undefined) {
      // Carried on the plane of its top, where a solid is usually taken hold of.
      const z = canvasTop(card);
      const world = this.planeAt(press.local, z);
      const carried = carriedIds(card.id, this.host.selection());
      this.gesture = { kind: "card", z, carried, last: world };
      this.host.cardPress(card, press, () => {
        if (world === null) return;
        const type = press.altKey ? "lift/start" : "move/start";
        this.host.dispatch({ type, id: card.id, screen, world });
      });
    } else {
      // Owner answer 4 of the 3D workspace plan: Shift-drag here is a
      // screen-space marquee. Today every empty-space drag orbits.
      // GAP [[01M41AB88FH1G58NR7AZE0SZJF]]
      const kind = pans ? "pan" : "orbit";
      this.gesture = { kind, ...screen, startX: screen.x, startY: screen.y };
    }
    return true;
  }

  move(press: ScenePress): SceneCursor {
    const g = this.gesture;
    if (g === null) {
      if (this.host.gizmo().hover(press.local)) return "grab";
      return this.cardAt(press.local) === undefined ? "" : "grab";
    }
    if (g.kind === "gizmo") {
      const transform = this.host.gizmo().drag(press.local);
      if (transform !== null) {
        this.host.dispatch({ type: "transform/move", transform, free: press.metaKey });
      }
      return "grabbing";
    }
    if (g.kind === "card") {
      const world = this.carryPoint(press.local, g);
      if (world === null) return "grabbing";
      g.last = world;
      const screen = { x: press.clientX, y: press.clientY };
      const { shiftKey, metaKey: free } = press;
      this.host.dispatch({ type: "pointer/move", screen, world, shiftKey, free });
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
    if (g.kind === "gizmo") {
      this.host.gizmo().release();
      const screen = { x: press.clientX, y: press.clientY };
      this.host.dispatch(
        cancelled ? { type: "pointer/cancel" } : { type: "pointer/end", screen, world: screen },
      );
      return;
    }
    if (g.kind === "card") {
      if (cancelled) {
        this.host.dispatch({ type: "pointer/cancel" });
        return;
      }
      // Released where the plane is edge-on: the card stays where the drag last had it.
      const world = this.carryPoint(press.local, g) ?? g.last;
      if (world === null) {
        this.host.dispatch({ type: "pointer/cancel" });
        return;
      }
      const screen = { x: press.clientX, y: press.clientY };
      const { shiftKey, metaKey: free } = press;
      this.host.dispatch({ type: "pointer/end", screen, world, shiftKey, free });
      return;
    }
    const tap = !pastSlop(press.clientX - g.startX, press.clientY - g.startY);
    // A tap moved no camera: on empty canvas it means the tool or the selection.
    if (tap) {
      if (g.kind === "orbit" && !cancelled) this.host.tapEmpty(this.planeAt(press.local, 0), press);
      return;
    }
    this.host.settled();
  }

  private cardAt(local: CanvasPoint): CanvasNode | undefined {
    const items = this.host.items();
    const id = hitTest(paintOrder(items), this.host.view(), this.host.size(), local);
    return id === null ? undefined : items.find((n) => n.id === id);
  }

  /**
   * Where a carry's pointer is: where it visibly is — on the top of a solid
   * it is over, one the drag does not carry, which is how an item is
   * carried onto another (the pointer reducer's surface snap then stands it
   * there) — and otherwise on the plane the carried item was taken hold of.
   */
  private carryPoint(
    local: CanvasPoint,
    g: Extract<Gesture, { kind: "card" }>,
  ): CanvasPoint3 | null {
    const others = this.host.items().filter((item) => !g.carried.has(item.id));
    const id = hitTest(paintOrder(others), this.host.view(), this.host.size(), local);
    const under = others.find((item) => item.id === id);
    if (under !== undefined && canvasDepth(under) > 0) {
      const top = this.planeAt(local, canvasTop(under));
      if (top !== null && coversFromAbove(under, top)) return top;
    }
    return this.planeAt(local, g.z);
  }

  private planeAt(local: CanvasPoint, z: number): CanvasPoint3 | null {
    return screenToPlane(this.host.view(), this.host.size(), local, z);
  }
}
