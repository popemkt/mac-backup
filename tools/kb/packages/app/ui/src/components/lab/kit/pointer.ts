/**
 * The lab's pointer and pan controls (Lab principles P4, M3): every study
 * that follows the pointer or turns under a drag uses these two, and neither
 * allocates per event or per frame (P3).
 *
 * A press is one of two things, decided when it lands: a pan (the view
 * turns) or a grab (the study moves something it hit — a star, the sun).
 * The study answers `grab` with what it took, or `null` for a pan.
 */
import { Vector3, type PerspectiveCamera } from "three/webgpu";
import {
  panCoast,
  panDrag,
  panRelease,
  restingPan,
  type Pan,
  type PanLimits,
} from "@/components/lab/kit/pan";

/** Where the pointer is over a host element, and where that lands on a plane. */
export class PointerField {
  /** Host-relative CSS pixels. */
  x = 0;
  y = 0;
  /** -1…1 across the host, +y up. */
  ndcX = 0;
  ndcY = 0;
  inside = false;
  /** `performance.now()` of the last move. */
  movedAt = -Infinity;
  private readonly host: HTMLElement;
  private readonly ray = new Vector3();
  private readonly normal = new Vector3();
  private readonly onMove = (event: PointerEvent) => {
    const rect = this.host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.x = event.clientX - rect.left;
    this.y = event.clientY - rect.top;
    this.ndcX = (this.x / rect.width) * 2 - 1;
    this.ndcY = 1 - (this.y / rect.height) * 2;
    this.inside = true;
    this.movedAt = performance.now();
  };
  private readonly onLeave = () => {
    this.inside = false;
  };

  constructor(host: HTMLElement) {
    this.host = host;
    host.addEventListener("pointermove", this.onMove);
    host.addEventListener("pointerleave", this.onLeave);
  }

  /** Seconds since the pointer last moved. */
  idleFor(now: number): number {
    return (now - this.movedAt) / 1000;
  }

  /**
   * The pointer's ray through `camera`, met with the plane through the origin
   * whose normal is the `axis` ("y": the floor, "z": facing the camera).
   * Writes into `out`; false when the ray runs parallel to the plane.
   */
  onPlane(camera: PerspectiveCamera, axis: "y" | "z", out: Vector3): boolean {
    this.ray.set(this.ndcX, this.ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
    const along = this.ray[axis];
    if (Math.abs(along) < 1e-5) return false;
    const t = -camera.position[axis] / along;
    out.copy(camera.position).addScaledVector(this.ray, t);
    return t > 0;
  }

  /**
   * The pointer's ray met with the plane through `through` that faces the
   * camera — the plane to follow the pointer on when the camera orbits.
   * Writes into `out`; false when the plane is behind the eye.
   */
  onFacing(camera: PerspectiveCamera, through: Vector3, out: Vector3): boolean {
    camera.getWorldDirection(this.normal);
    this.ray.set(this.ndcX, this.ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
    const along = this.ray.dot(this.normal);
    if (Math.abs(along) < 1e-5) return false;
    const t = out.copy(through).sub(camera.position).dot(this.normal) / along;
    out.copy(camera.position).addScaledVector(this.ray, t);
    return t > 0;
  }

  dispose(): void {
    this.host.removeEventListener("pointermove", this.onMove);
    this.host.removeEventListener("pointerleave", this.onLeave);
  }
}

/** What a press took hold of, fed host-relative CSS pixels until it lets go. */
export interface Grab {
  move(x: number, y: number): void;
  /** `moved`: whether the press travelled, so a still press can read as a tap. */
  end(moved: boolean): void;
}

/** Drag to turn, release to coast (the arithmetic is `kit/pan`). */
export class PanControl {
  readonly pan: Pan = restingPan();
  dragging = false;
  /** What the current press holds instead of the view, if anything. */
  held: Grab | null = null;
  private lastX = 0;
  private lastY = 0;
  private lastAt = 0;
  /** Pixels moved during this press: a press that barely moves is a tap. */
  private travelled = 0;
  private readonly host: HTMLElement;
  private readonly limits: PanLimits;
  private readonly onTap: () => void;
  private readonly onChange: () => void;
  private readonly grab: (x: number, y: number) => Grab | null;
  /** The press's host-relative point, written in place (no per-event garbage). */
  private atX = 0;
  private atY = 0;
  private locate(event: PointerEvent): void {
    const rect = this.host.getBoundingClientRect();
    this.atX = event.clientX - rect.left;
    this.atY = event.clientY - rect.top;
  }
  private readonly onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.lastAt = performance.now();
    this.travelled = 0;
    this.host.setPointerCapture(event.pointerId);
    this.locate(event);
    this.held = this.grab(this.atX, this.atY);
    if (this.held !== null) return;
    this.dragging = true;
    this.pan.yawSpeed = 0;
    this.pan.pitchSpeed = 0;
  };
  private readonly onMove = (event: PointerEvent) => {
    if (!this.dragging && this.held === null) return;
    const now = performance.now();
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    if (this.held === null) panDrag(this.pan, this.limits, dx, dy, (now - this.lastAt) / 1000);
    else {
      this.locate(event);
      this.held.move(this.atX, this.atY);
    }
    this.travelled += Math.abs(dx) + Math.abs(dy);
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.lastAt = now;
    this.onChange();
  };
  private readonly onUp = (event: PointerEvent) => {
    if (!this.dragging && this.held === null) return;
    if (this.host.hasPointerCapture(event.pointerId))
      this.host.releasePointerCapture(event.pointerId);
    const still = this.travelled < 4;
    if (this.held !== null) {
      this.held.end(!still);
      this.held = null;
    } else {
      this.dragging = false;
      panRelease(this.pan, (performance.now() - this.lastAt) / 1000);
      if (still) this.onTap();
    }
    this.onChange();
  };
  private readonly onCancel = () => {
    this.held?.end(true);
    this.held = null;
    this.dragging = false;
  };

  constructor(
    host: HTMLElement,
    limits: PanLimits,
    callbacks: {
      onTap?: () => void;
      onChange: () => void;
      /** A press the study takes for itself; `null` (the default) pans. */
      grab?: (x: number, y: number) => Grab | null;
    },
  ) {
    this.host = host;
    this.limits = limits;
    this.onTap = callbacks.onTap ?? (() => {});
    this.onChange = callbacks.onChange;
    this.grab = callbacks.grab ?? (() => null);
    host.addEventListener("pointerdown", this.onDown);
    host.addEventListener("pointermove", this.onMove);
    host.addEventListener("pointerup", this.onUp);
    host.addEventListener("pointercancel", this.onCancel);
  }

  /** Coast while not held. */
  frame(dt: number, reducedMotion: boolean): void {
    if (!this.dragging) panCoast(this.pan, this.limits, dt, reducedMotion);
  }

  dispose(): void {
    this.host.removeEventListener("pointerdown", this.onDown);
    this.host.removeEventListener("pointermove", this.onMove);
    this.host.removeEventListener("pointerup", this.onUp);
    this.host.removeEventListener("pointercancel", this.onCancel);
  }
}
