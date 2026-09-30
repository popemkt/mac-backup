/**
 * The canvas camera in motion: the one view a projection draws with, moved
 * by gestures and eased by flights (DESIGN-UI.md → Canvas → Projections).
 *
 * Gestures (orbit, pan, zoom about a point) move the view at once, because a
 * hand on the canvas wants no lag. A flight eases from the view it starts at
 * to a goal over `--motion-duration-arrive` on `--motion-settle`: switching
 * projection is a flight, and so is zoom-to-fit. Under reduced motion a
 * flight lands at once (M7). The rig knows no renderer: whoever draws steps
 * it once a frame and is woken when the view changes between frames.
 */
import {
  clampZoom,
  fitView,
  lerpView,
  orbitView,
  panView,
  zoomViewAt,
  type CanvasHitItem,
  type CanvasPoint,
  type CanvasView,
  type CanvasViewportControls,
  type ViewSize,
} from "@/lib/canvas-camera";
import { easeAt, type Timing } from "@/lib/timing";

interface Flight {
  readonly from: CanvasView;
  readonly to: CanvasView;
  elapsed: number;
  readonly arrive: (() => void) | undefined;
}

const middle = (size: ViewSize) => ({ x: size.width / 2, y: size.height / 2 });

export class CanvasCameraRig {
  private current: CanvasView;
  private flight: Flight | null = null;
  private reduced: boolean;
  private readonly timing: Timing;
  /** Draw a frame: set by the renderer that steps this rig. */
  wake: () => void = () => {};

  constructor(view: CanvasView, timing: Timing, reducedMotion: boolean) {
    this.current = view;
    this.timing = timing;
    this.reduced = reducedMotion;
  }

  get view(): CanvasView {
    return this.current;
  }

  /** A flight is under way. */
  get flying(): boolean {
    return this.flight !== null;
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    if (reduced && this.flight !== null) this.land(this.flight);
  }

  /** Stand at `view` now, dropping any flight (its arrival never comes). */
  jump(view: CanvasView): void {
    this.flight = null;
    this.current = view;
    this.wake();
  }

  /**
   * Ease to `goal` after `delay` seconds held still; `arrive` runs once it is
   * reached, or at once under reduced motion.
   */
  flyTo(goal: CanvasView, arrive?: () => void, delay = 0): void {
    const flight: Flight = { from: this.current, to: goal, elapsed: -delay, arrive };
    if (this.reduced || this.timing.arrive <= 0) {
      this.land(flight);
      return;
    }
    this.flight = flight;
    this.wake();
  }

  orbitBy(dx: number, dy: number): void {
    this.jump(orbitView(this.current, dx, dy));
  }

  panBy(dx: number, dy: number): void {
    this.jump(panView(this.current, dx, dy));
  }

  zoomAt(factor: number, screen: CanvasPoint, size: ViewSize): void {
    this.jump(zoomViewAt(this.current, size, factor, screen));
  }

  /** Advance a flight by `dt` seconds; whether the view is still moving. */
  step(dt: number): boolean {
    const flight = this.flight;
    if (flight === null) return false;
    flight.elapsed += dt;
    const t = Math.min(1, Math.max(0, flight.elapsed) / this.timing.arrive);
    if (t >= 1) {
      this.land(flight);
      return false;
    }
    this.current = lerpView(flight.from, flight.to, easeAt(this.timing.settle, t));
    return true;
  }

  /**
   * What the keymap asks of this camera: zoom about the middle of the
   * viewport, or fly to frame every item.
   */
  controls(
    size: () => ViewSize,
    items: () => readonly CanvasHitItem[],
    settled: () => void,
  ): CanvasViewportControls {
    return {
      zoomBy: (factor) => {
        const s = size();
        this.zoomAt(factor, middle(s), s);
        settled();
      },
      zoomTo: (zoom) => {
        const s = size();
        this.zoomAt(clampZoom(zoom) / this.current.zoom, middle(s), s);
        settled();
      },
      fit: () => {
        const framed = fitView(items(), size(), this.current);
        if (framed !== null) this.flyTo(framed, settled);
      },
    };
  }

  private land(flight: Flight): void {
    this.flight = null;
    this.current = flight.to;
    this.wake();
    flight.arrive?.();
  }
}
