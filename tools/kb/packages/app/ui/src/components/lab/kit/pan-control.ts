/**
 * Drag to turn, release to coast (Lab principles P4, M3): every study that
 * turns under a drag uses this one control, and it allocates nothing per
 * event (P3). A press is one of two things, decided when it lands: a pan
 * (the view turns) or a grab (the study moves something it hit — a star, the
 * sun); the study answers `grab` with what it took, or `null` for a pan. The
 * arithmetic is `kit/pan`; where the pointer is over the scene is the scene
 * kit's `PointerField` (`@/scene/gpu/pointer`).
 */
import {
  panCoast,
  panDrag,
  panRelease,
  restingPan,
  type Pan,
  type PanLimits,
} from "@/components/lab/kit/pan";

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
