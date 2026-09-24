/**
 * The lab's pointer control (Lab principles P4): every study that follows
 * the pointer uses it, and it allocates nothing per event or per frame (P3).
 */
import { Vector3, type PerspectiveCamera } from "three/webgpu";

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

  dispose(): void {
    this.host.removeEventListener("pointermove", this.onMove);
    this.host.removeEventListener("pointerleave", this.onLeave);
  }
}
