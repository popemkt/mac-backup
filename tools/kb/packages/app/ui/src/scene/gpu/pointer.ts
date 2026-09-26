/**
 * The pointer over a scene's element (Lab principles P3, M5): where it is,
 * whether it is inside, when it last moved, where its ray meets a plane, and
 * which presses were taps. Every real-time 3D view that follows or picks
 * with the pointer — the lab's studies and the 3D graph — reads this one
 * field, which allocates nothing per event or per frame.
 *
 * A tap is a primary-button press released within `TAP_SLOP` CSS pixels of
 * where it went down: a drag that orbits or pans is not a tap.
 */
import { Vector3, type PerspectiveCamera } from "three/webgpu";

/** Pointer travel under which a press is a tap, not a drag (CSS px). */
const TAP_SLOP = 4;

export interface PointerFieldEvents {
  /** The pointer moved over the element, or left it. */
  readonly onChange?: () => void;
  /** A tap at host-relative CSS pixels. */
  readonly onTap?: (x: number, y: number) => void;
}

export class PointerField {
  /** Host-relative CSS pixels. */
  x = 0;
  y = 0;
  /** -1…1 across the host, +y up. */
  ndcX = 0;
  ndcY = 0;
  inside = false;
  /** A primary button is down over the element (a tap or a drag under way). */
  pressed = false;
  /** `performance.now()` of the last move. */
  movedAt = -Infinity;
  private pressX = 0;
  private pressY = 0;
  private readonly host: HTMLElement;
  private readonly events: PointerFieldEvents;
  private readonly ray = new Vector3();
  private readonly normal = new Vector3();
  /** Where `event` lands in the host; false when the host has no size. */
  private place(event: PointerEvent): boolean {
    const rect = this.host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    this.x = event.clientX - rect.left;
    this.y = event.clientY - rect.top;
    this.ndcX = (this.x / rect.width) * 2 - 1;
    this.ndcY = 1 - (this.y / rect.height) * 2;
    return true;
  }
  private readonly onMove = (event: PointerEvent) => {
    if (!this.place(event)) return;
    this.inside = true;
    this.movedAt = performance.now();
    this.events.onChange?.();
  };
  private readonly onLeave = () => {
    this.inside = false;
    this.events.onChange?.();
  };
  private readonly onDown = (event: PointerEvent) => {
    if (event.button !== 0 || !this.place(event)) return;
    this.pressed = true;
    this.pressX = this.x;
    this.pressY = this.y;
  };
  private readonly onUp = (event: PointerEvent) => {
    const was = this.pressed;
    this.pressed = false;
    if (!was || !this.place(event)) return;
    if (Math.hypot(this.x - this.pressX, this.y - this.pressY) <= TAP_SLOP) {
      this.events.onTap?.(this.x, this.y);
    }
  };
  private readonly onCancel = () => {
    this.pressed = false;
  };

  constructor(host: HTMLElement, events: PointerFieldEvents = {}) {
    this.host = host;
    this.events = events;
    host.addEventListener("pointermove", this.onMove);
    host.addEventListener("pointerleave", this.onLeave);
    host.addEventListener("pointerdown", this.onDown);
    host.addEventListener("pointerup", this.onUp);
    host.addEventListener("pointercancel", this.onCancel);
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
    this.host.removeEventListener("pointerdown", this.onDown);
    this.host.removeEventListener("pointerup", this.onUp);
    this.host.removeEventListener("pointercancel", this.onCancel);
  }
}
