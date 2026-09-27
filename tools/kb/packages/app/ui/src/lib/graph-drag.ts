/**
 * Dragging a node in a graph view: one gesture, whatever draws the graph.
 *
 * A press on a node suspends whatever else the pointer drives (the 2D
 * camera's pan, the 3D orbit); once the press has travelled past the pointer
 * slop it is a drag: the layout grabs the node and holds it under the
 * pointer, move by move, until the release drops it. A press that never
 * passed the slop is a click, and stays one.
 *
 * What a layout does with a held node is the layout's (`DragLayout`, the
 * port every graph layout implements, proved by one contract suite over all
 * of them): a force layout runs while a node is held, so its neighbours
 * follow, and cools and stops after the drop; a placed layout only moves the
 * node. Where the pointer puts the node is the renderer's (`DragSurface`):
 * the 2D camera's inverse, or the plane through the node facing the 3D eye.
 */
import { pastSlop } from "./pointer-slop";

/** Where a held node stands, in the layout's own coordinates (2D leaves `z` out). */
export interface LayoutPoint {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
}

/**
 * A layout a node can be dragged in. `grab` takes hold of node `id` where it
 * stands; `hold` stands it at `at`; `drop` lets it go, free again (a dropped
 * node is never left pinned). An unknown id is ignored: a new graph may
 * replace the layout under a drag.
 */
export interface DragLayout {
  grab(id: string): void;
  hold(id: string, at: LayoutPoint): void;
  drop(id: string): void;
}

/** What a renderer lends the gesture. */
export interface DragSurface {
  /** A press landed on a node: nothing else the pointer drives may move. */
  suspend(): void;
  /** The press is over, drag or click. */
  resume(): void;
  /**
   * The press on node `id` at (x, y) became a drag: take the view still and
   * return where the node should stand for each later pointer position, so
   * the node keeps the offset it was pressed at. Null when it cannot follow
   * (the node is gone).
   */
  grip(id: string, x: number, y: number): ((x: number, y: number) => LayoutPoint | null) | null;
}

interface Press {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  follow: ((x: number, y: number) => LayoutPoint | null) | null;
}

/** One node drag, from press to release, over whichever layout is current. */
export class NodeDrag {
  private press: Press | null = null;
  private readonly layout: () => DragLayout;
  private readonly surface: DragSurface;

  constructor(layout: () => DragLayout, surface: DragSurface) {
    this.layout = layout;
    this.surface = surface;
  }

  /** The node under a press, drag or not yet. */
  get pressed(): string | null {
    return this.press?.id ?? null;
  }

  /** The node being dragged (the press passed the slop). */
  get dragging(): string | null {
    return this.press?.follow ? this.press.id : null;
  }

  /** A press on node `id` at viewport (x, y). */
  down(id: string, x: number, y: number): void {
    this.up();
    this.press = { id, x, y, follow: null };
    this.surface.suspend();
  }

  /** The pointer moved to (x, y); whether the node is being dragged. */
  move(x: number, y: number): boolean {
    const press = this.press;
    if (press === null) return false;
    if (press.follow === null) {
      if (!pastSlop(x - press.x, y - press.y)) return false;
      press.follow = this.surface.grip(press.id, press.x, press.y);
      if (press.follow === null) return false;
      this.layout().grab(press.id);
    }
    const at = press.follow(x, y);
    if (at !== null) this.layout().hold(press.id, at);
    return true;
  }

  /** The press is over; whether it was a drag (so it is not also a click). */
  up(): boolean {
    const press = this.press;
    if (press === null) return false;
    this.press = null;
    const dragged = press.follow !== null;
    if (dragged) this.layout().drop(press.id);
    this.surface.resume();
    return dragged;
  }
}
