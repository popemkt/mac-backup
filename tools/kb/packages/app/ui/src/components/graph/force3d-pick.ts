/**
 * What is under the pointer in the 3D graph, and what a tap on it means.
 *
 * A node is under the pointer when its drawn disc (at least a finger's
 * reach) covers the point and it is present (not dimmed away); the nearest
 * such node wins. Screen positions come from the scene kit's one projection
 * (`toScreen`). The pointer itself is the kit's `PointerField`: a move marks
 * the hover stale, and it is re-picked once on the next frame; a tap selects,
 * and a second tap on the same node soon after opens it.
 */
import type { PerspectiveCamera } from "three/webgpu";
import { PointerField } from "@/scene/gpu/pointer";
import { pixelsPerUnit, toScreen, type ScreenPoint } from "@/scene/gpu/screen";

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

/** The pointer over the 3D graph's canvas: hover, select and open. */
export class GraphPick {
  hovered: string | null = null;
  private stale = true;
  private lastTap = { id: "", at: 0 };
  private readonly pointer: PointerField;
  private readonly canvas: HTMLCanvasElement;
  private readonly size = { width: 0, height: 0 };
  private readonly field: PickField;
  private readonly camera: PerspectiveCamera;
  private readonly events: GraphPickEvents;

  constructor(
    view: { readonly canvas: HTMLCanvasElement; readonly camera: PerspectiveCamera },
    field: PickField,
    events: GraphPickEvents,
  ) {
    const { canvas } = view;
    this.canvas = canvas;
    this.camera = view.camera;
    this.field = field;
    this.events = events;
    this.pointer = new PointerField(canvas, {
      onChange: () => {
        this.stale = true;
        events.wake();
      },
      onTap: (x, y) => this.tap(x, y),
    });
  }

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
    const { pointer } = this;
    const i = pointer.inside && !pointer.pressed ? this.at(pointer.x, pointer.y) : -1;
    const id = this.field.idOf(i) ?? null;
    this.canvas.style.cursor = id === null ? "" : "pointer";
    if (id !== null) this.events.onHover({ id, x: pointer.x, y: pointer.y });
    if (id === this.hovered) return;
    this.hovered = id;
    if (id === null) this.events.onHover(null);
    this.events.onHoverChange(id);
  }

  dispose(): void {
    this.pointer.dispose();
  }
}
