/**
 * What is under the pointer in the 3D graph, and what a tap on it means.
 *
 * A node is under the pointer when its drawn disc (at least a finger's
 * reach) covers the point and it is present (not dimmed away); the nearest
 * such node wins. Screen positions come from the scene kit's one projection
 * (`toScreen`). The pointer itself is the kit's `PointerField`: a move marks
 * the hover stale, and it is re-picked once on the next frame; a tap selects,
 * and a second tap on the same node soon after opens it.
 *
 * A press on a node is also the start of a node drag (`lib/graph-drag`): it
 * is taken before the orbit sees it (a capture listener on the canvas, which
 * runs ahead of the orbit's own), so the orbit is suspended from the press
 * on; past the slop the node follows the pointer, and a press that became a
 * drag is never also a tap. While a node is pressed it stays the hovered
 * one, so its neighbourhood stays lit as it moves.
 */
import type { PerspectiveCamera } from "three/webgpu";
import type { NodeDrag } from "@/lib/graph-drag";
import { pixelsPerUnit, PointerField, toScreen, type ScreenPoint } from "@kb/scene-gpu";

/** The smallest reach a node has under the pointer, CSS px, and the slack past its disc. */
const MIN_REACH = 6;
const SLACK = 2;
const DOUBLE_TAP_MS = 320;

/** The nodes as picking sees them. */
export interface PickField {
  readonly positions: () => Float32Array;
  readonly count: () => number;
  readonly radius: (i: number) => number;
  /** Whether node `i` is present enough to be picked. */
  readonly present: (i: number) => boolean;
  readonly idOf: (i: number) => string | undefined;
}

const world = { x: 0, y: 0, z: 0 };
const onScreen: ScreenPoint = { x: 0, y: 0, depth: 0 };

/** The index of the nearest picked node at canvas point (x, y), or -1. */
export function pickNode(
  field: PickField,
  camera: PerspectiveCamera,
  size: { readonly width: number; readonly height: number },
  x: number,
  y: number,
): number {
  const positions = field.positions();
  let best = -1;
  let bestDepth = Infinity;
  for (let i = 0; i < field.count(); i++) {
    if (!field.present(i)) continue;
    world.x = positions[i * 3] ?? 0;
    world.y = positions[i * 3 + 1] ?? 0;
    world.z = positions[i * 3 + 2] ?? 0;
    if (!toScreen(world, camera, size, onScreen)) continue;
    const disc = field.radius(i) * pixelsPerUnit(camera, size.height, onScreen.depth);
    const reach = Math.max(MIN_REACH, disc) + SLACK;
    if (Math.hypot(onScreen.x - x, onScreen.y - y) <= reach && onScreen.depth < bestDepth) {
      best = i;
      bestDepth = onScreen.depth;
    }
  }
  return best;
}

export interface GraphPickEvents {
  readonly onSelect: (id: string | null) => void;
  readonly onOpen: (id: string) => void;
  readonly onHover: (hover: { readonly id: string; x: number; y: number } | null) => void;
  /** The hovered node changed: its emphasis must follow. */
  readonly onHoverChange: (id: string | null) => void;
  /** The pointer moved: a frame must re-pick. */
  readonly wake: () => void;
}

/** The pointer over the 3D graph's canvas: hover, select, open and drag. */
export class GraphPick {
  hovered: string | null = null;
  private stale = true;
  private lastTap = { id: "", at: 0 };
  /** The last press was a drag: the tap its release may still report is not one. */
  private dragged = false;
  private readonly pointer: PointerField;
  private readonly canvas: HTMLCanvasElement;
  private readonly size = { width: 0, height: 0 };
  private readonly field: PickField;
  private readonly camera: PerspectiveCamera;
  private readonly events: GraphPickEvents;
  private readonly drag: NodeDrag;

  constructor(
    view: { readonly canvas: HTMLCanvasElement; readonly camera: PerspectiveCamera },
    field: PickField,
    events: GraphPickEvents,
    drag: NodeDrag,
  ) {
    const { canvas } = view;
    this.canvas = canvas;
    this.camera = view.camera;
    this.field = field;
    this.events = events;
    this.drag = drag;
    this.pointer = new PointerField(canvas, {
      onChange: () => {
        this.stale = true;
        events.wake();
      },
      onTap: (x, y) => this.tap(x, y),
    });
    canvas.addEventListener("pointerdown", this.onPress, { capture: true });
    canvas.addEventListener("pointermove", this.onDrag, { capture: true });
    canvas.addEventListener("pointerup", this.onRelease, { capture: true });
    canvas.addEventListener("pointercancel", this.onRelease, { capture: true });
  }

  /** The node being pressed or dragged, if any. */
  get pressed(): string | null {
    return this.drag.pressed;
  }

  private local(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private readonly onPress = (event: PointerEvent) => {
    this.dragged = false;
    if (event.button !== 0) return;
    const { x, y } = this.local(event);
    const id = this.field.idOf(this.at(x, y));
    if (id === undefined) return;
    this.drag.down(id, x, y);
    // The drag keeps the pointer when it leaves the canvas.
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onDrag = (event: PointerEvent) => {
    if (this.drag.pressed === null) return;
    const { x, y } = this.local(event);
    if (this.drag.move(x, y)) this.canvas.style.cursor = "grabbing";
  };

  private readonly onRelease = (event: PointerEvent) => {
    if (this.drag.pressed === null) return;
    this.dragged = this.drag.up();
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId);
    this.stale = true;
    this.events.wake();
  };

  /** Whether a re-pick is still due (the frame should keep running). */
  get pending(): boolean {
    return this.stale;
  }

  private at(x: number, y: number): number {
    this.size.width = this.canvas.clientWidth;
    this.size.height = this.canvas.clientHeight;
    return pickNode(this.field, this.camera, this.size, x, y);
  }

  private tap(x: number, y: number): void {
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    const id = this.field.idOf(this.at(x, y)) ?? null;
    const now = performance.now();
    if (id !== null && this.lastTap.id === id && now - this.lastTap.at < DOUBLE_TAP_MS) {
      this.events.onOpen(id);
      return;
    }
    this.lastTap = { id: id ?? "", at: now };
    this.events.onSelect(id);
  }

  /** Re-pick the hover if the pointer moved since the last frame. */
  frame(): void {
    if (!this.stale) return;
    this.stale = false;
    const { pointer, drag } = this;
    const i = pointer.inside && !pointer.pressed ? this.at(pointer.x, pointer.y) : -1;
    const id = drag.pressed ?? this.field.idOf(i) ?? null;
    this.canvas.style.cursor = drag.dragging !== null ? "grabbing" : id === null ? "" : "pointer";
    if (id !== null) this.events.onHover({ id, x: pointer.x, y: pointer.y });
    if (id === this.hovered) return;
    this.hovered = id;
    if (id === null) this.events.onHover(null);
    this.events.onHoverChange(id);
  }

  dispose(): void {
    this.drag.up();
    this.pointer.dispose();
    const { canvas } = this;
    canvas.removeEventListener("pointerdown", this.onPress, { capture: true });
    canvas.removeEventListener("pointermove", this.onDrag, { capture: true });
    canvas.removeEventListener("pointerup", this.onRelease, { capture: true });
    canvas.removeEventListener("pointercancel", this.onRelease, { capture: true });
  }
}
