/**
 * What the pointer does in the Sky: which star it is on (named, and its
 * constellation drawn), and what a press takes hold of. A press on the
 * hovered star moves that star, a press on the moon or the sun moves that
 * body — each at its own depth, so it slides across the view rather than
 * toward or away — and anything else is the orbit's. A press on a star that
 * never moves is a click, and opens the node.
 *
 * Every screen position is the graph's `toScreen`, the one projection that is
 * right under both backends (it decides "in view" in camera space).
 */
import { Vector3, type Mesh, type Object3D, type PerspectiveCamera } from "three/webgpu";
import type { LabSceneInit } from "@/components/lab/kit/contract";
import { PointerField, type Grab } from "@/components/lab/kit/pointer";
import { toScreen, type ScreenPoint } from "@/components/graph/force3d-screen"; // GAP [[01M3E9QMKPDBB9KEYCDYHT3WG1]]
import type { NodeStars } from "@/components/lab/sky/stars";

/** Pixels within which the pointer is on a star; a glint is easier to hit. */
const HIT_STAR = 10;
const HIT_GLINT = 26;

export interface SkyBodies {
  readonly sun: Object3D;
  readonly sunRadius: number;
  readonly moon: Mesh;
  readonly moonRadius: number;
  /** Stand the sun at `to` (the moon's light follows). */
  readonly moveSun: (to: Vector3) => void;
}

export class SkyHands {
  /** The star under the pointer, or -1. */
  hovered = -1;
  private readonly pointer: PointerField;
  private readonly size = { width: 0, height: 0 };
  private readonly screen: ScreenPoint = { x: 0, y: 0, depth: 0 };
  private readonly edge = new Vector3();
  private readonly scratch = new Vector3();
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: PerspectiveCamera;
  private readonly bodies: SkyBodies;
  private readonly stars: () => NodeStars;
  private readonly init: Pick<LabSceneInit, "onHover" | "onOpen">;
  private readonly onHovered: (index: number) => void;

  constructor(
    view: {
      readonly host: HTMLElement;
      readonly canvas: HTMLCanvasElement;
      readonly camera: PerspectiveCamera;
    },
    bodies: SkyBodies,
    stars: () => NodeStars,
    init: Pick<LabSceneInit, "onHover" | "onOpen">,
    /** The hovered star changed (-1: none). */
    onHovered: (index: number) => void,
  ) {
    this.pointer = new PointerField(view.host);
    this.canvas = view.canvas;
    this.camera = view.camera;
    this.bodies = bodies;
    this.stars = stars;
    this.init = init;
    this.onHovered = onHovered;
  }

  /** What a press at (x, y) takes: a star, the moon, the sun, or nothing (the orbit). */
  grab(x: number, y: number): Grab | null {
    const stars = this.stars();
    const index = this.hovered;
    const point = stars.points[index];
    if (point !== undefined) {
      return this.drag(
        point,
        (to) => stars.move(index, to),
        (moved) => {
          const node = stars.node(index);
          if (!moved && node !== undefined) this.init.onOpen(node.id);
        },
      );
    }
    const { moon, sun, moveSun } = this.bodies;
    if (this.onBody(x, y, moon.position, this.bodies.moonRadius))
      return this.drag(moon.position, (to) => moon.position.copy(to));
    if (this.onBody(x, y, sun.position, this.bodies.sunRadius))
      return this.drag(sun.position, moveSun);
    return null;
  }

  /**
   * Once a frame, after the camera moved: while something is held the hover
   * stays put (its label follows its star); otherwise it is the node star
   * nearest the pointer, preferring glints, within reach.
   */
  frame(holding: boolean): void {
    this.measure();
    if (holding) {
      this.label(this.hovered);
      return;
    }
    const stars = this.stars();
    let best = -1;
    let bestScore = Infinity;
    const { pointer, screen } = this;
    for (let i = 0; pointer.inside && i < stars.points.length; i++) {
      const point = stars.points[i];
      const node = stars.node(i);
      if (point === undefined || node === undefined) continue;
      if (!toScreen(point, this.camera, this.size, screen)) continue;
      const distance = Math.hypot(screen.x - pointer.x, screen.y - pointer.y);
      const score = distance - (node.glint ? 6 : 0);
      if (distance <= (node.glint ? HIT_GLINT : HIT_STAR) && score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    this.hover(best);
  }

  /** Forget the hover (the stars were rebuilt). */
  reset(): void {
    this.hovered = -1;
    this.onHovered(-1);
    this.init.onHover(null);
  }

  dispose(): void {
    this.pointer.dispose();
  }

  private hover(index: number): void {
    if (index !== this.hovered) {
      this.hovered = index;
      this.stars().constellation(index);
      this.onHovered(index);
      if (index < 0) this.init.onHover(null);
    }
    this.label(index);
  }

  private label(index: number): void {
    const stars = this.stars();
    const node = stars.node(index);
    const point = stars.points[index];
    if (node === undefined || point === undefined) return;
    if (toScreen(point, this.camera, this.size, this.screen))
      this.init.onHover({ id: node.id, label: node.label, x: this.screen.x, y: this.screen.y });
  }

  private measure(): void {
    this.size.width = this.canvas.clientWidth;
    this.size.height = this.canvas.clientHeight;
  }

  /** Whether pixel (x, y) is on a body of `radius` at `centre`. */
  private onBody(x: number, y: number, centre: Vector3, radius: number): boolean {
    this.measure();
    const { screen } = this;
    if (!toScreen(centre, this.camera, this.size, screen)) return false;
    const cx = screen.x;
    const cy = screen.y;
    this.edge.copy(this.camera.up).multiplyScalar(radius).add(centre);
    if (!toScreen(this.edge, this.camera, this.size, screen)) return false;
    return Math.hypot(x - cx, y - cy) <= Math.hypot(screen.x - cx, screen.y - cy) * 1.1;
  }

  /** Move `point`'s thing under the pointer, keeping its depth. */
  private drag(point: Vector3, place: (to: Vector3) => void, end?: (moved: boolean) => void): Grab {
    const to = new Vector3();
    return {
      move: (x, y) => {
        this.measure();
        // Depth in normalised device space: the only coordinate the pointer does not give.
        this.scratch.copy(point).project(this.camera);
        to.set((x / this.size.width) * 2 - 1, 1 - (y / this.size.height) * 2, this.scratch.z);
        place(to.unproject(this.camera));
      },
      end: (moved) => end?.(moved),
    };
  }
}
