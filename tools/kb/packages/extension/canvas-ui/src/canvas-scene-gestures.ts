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
 * - On an item: a press selects what it reaches — the item, or the group it
 *   stands for when that group is not entered — (a modifier toggles it) and
 *   a drag carries it across the floor plan; with Alt, held to Z. Both go
 *   through the canvas pointer reducer, which reads the pointer through the
 *   camera model, so a 3D drag is the same transform, history step and
 *   write as a 2D one. A double-click enters the group on the way to it.
 * - On empty canvas: a drag orbits, a tap is the armed tool's (or clears
 *   the selection). The armed tool sees through an item it takes
 *   (`toolTakes`) as through empty canvas: a placing tool through a frame,
 *   so a tap on one places inside it.
 * - The right or middle button, or Space, pans.
 */
import { paintOrder, type CanvasNode } from "@kb/canvas";
import { hitTest, type CanvasPoint, type CanvasView, type ViewSize } from "./canvas-camera";
import { placeUnder } from "./canvas-faces";
import type { CanvasPointerEvent } from "./canvas-pointer";
import { ALONG_Z } from "./canvas-transform-input";
import type { SceneGizmo } from "./canvas-gizmo";
import type { ToolSpot } from "./canvas-tool";
import type { CanvasSelection } from "./canvas-selection";
import { pastSlop } from "@kb/ui-sdk";

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
  readonly panning: () => boolean;
  /** Whether the armed tool takes a press on `item` rather than the item (`toolTakes`). */
  readonly takes: (item: CanvasNode) => boolean;
  /** A modal transform (G, S, E) is under way. */
  readonly transforming: () => boolean;
  /** The gizmo on the selection. */
  readonly gizmo: () => SceneGizmo;
  /** A press on a card: select or toggle what it reaches, then `startMove` to carry that, by id. */
  readonly cardPress: (
    card: CanvasNode,
    press: ScenePress,
    startMove: (id: string) => void,
  ) => void;
  /** A double-click on a card: into the group on the way to it; whether it went. */
  readonly cardDoubleClick: (card: CanvasNode) => boolean;
  readonly dispatch: (event: CanvasPointerEvent) => void;
  readonly orbit: (dx: number, dy: number) => void;
  readonly pan: (dx: number, dy: number) => void;
  /** A tap on empty canvas, or on an item the armed tool takes: the spot the tool would take there. */
  readonly tap: (spot: ToolSpot, press: ScenePress) => void;
  /**
   * A press the armed tool draws from as it goes down (a stroke tool's), on
   * empty canvas or an item it takes: whether it began a stroke, which the
   * pointer reducer then carries.
   */
  readonly draw: (spot: ToolSpot, press: ScenePress) => boolean;
  /** An orbit or a pan came to rest. */
  readonly settled: () => void;
}

type Gesture =
  | { readonly kind: "gizmo" }
  /** A drag the pointer reducer carries, every move and the release sent on to it: a card's move, a stroke. */
  | { readonly kind: "carried" }
  | {
      readonly kind: "orbit" | "pan";
      x: number;
      y: number;
      readonly startX: number;
      readonly startY: number;
      /** The item the armed tool was pressed on, which it takes (`toolTakes`). */
      readonly taken?: CanvasNode;
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
      // A press only ends a modal transform; the reducer says how. The host swallows the menu.
      this.host.dispatch({ type: "transform/press", button: press.button, ctrlKey: press.ctrlKey });
      return false;
    }
    const pans = press.button === 1 || press.button === 2 || this.host.panning();
    if (!pans && press.button !== 0) return false;
    if (!pans && this.host.gizmo().press(press.local)) {
      this.gesture = { kind: "gizmo" };
      this.host.dispatch({ type: "transform/start" });
      return true;
    }
    const hit = pans ? undefined : this.cardAt(press.local);
    // The armed tool takes a press on an item it takes: a placing tool places on a frame, not into it.
    const taken = hit !== undefined && this.host.takes(hit) ? hit : undefined;
    const card = taken === undefined ? hit : undefined;
    if (!pans && card === undefined) {
      const place = placeUnder(this.host.view(), this.host.size(), press.local, taken);
      if (this.host.draw({ place, item: taken ?? null }, press)) {
        this.gesture = { kind: "carried" };
        return true;
      }
    }
    if (card !== undefined) {
      this.gesture = { kind: "carried" };
      this.host.cardPress(card, press, (id) => {
        const along = press.altKey ? { along: ALONG_Z } : {};
        this.host.dispatch({ type: "move/start", id, screen: press.local, ...along });
      });
    } else {
      // Owner answer 4 of the 3D workspace plan: Shift-drag here is a
      // screen-space marquee. Today every empty-space drag orbits.
      // GAP [[01M41AB88FH1G58NR7AZE0SZJF]]
      const kind = pans ? "pan" : "orbit";
      const screen = { x: press.clientX, y: press.clientY };
      this.gesture = { kind, ...screen, startX: screen.x, startY: screen.y, taken };
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
    if (g.kind === "carried") {
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
    if (g.kind === "gizmo" || g.kind === "carried") {
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
        const place = placeUnder(this.host.view(), this.host.size(), press.local, g.taken);
        this.host.tap({ place, item: g.taken ?? null }, press);
      }
      return;
    }
    this.host.settled();
  }

  /** A double-click: on an item, into the group on the way to it. A modal transform takes none. */
  doubleClick(press: ScenePress): void {
    if (this.host.transforming() || press.button !== 0) return;
    const card = this.cardAt(press.local);
    if (card !== undefined) this.host.cardDoubleClick(card);
  }

  /** The items in paint order, read again only when the document changes (hover asks on every move). */
  private ordered: { readonly of: readonly CanvasNode[]; readonly order: CanvasNode[] } | null =
    null;

  private cardAt(local: CanvasPoint): CanvasNode | undefined {
    const items = this.host.items();
    if (this.ordered?.of !== items) this.ordered = { of: items, order: paintOrder(items) };
    const id = hitTest(this.ordered.order, this.host.view(), this.host.size(), local);
    return id === null ? undefined : items.find((n) => n.id === id);
  }
}
