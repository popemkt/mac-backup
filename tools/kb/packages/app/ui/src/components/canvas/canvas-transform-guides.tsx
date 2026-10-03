/**
 * What a modal transform shows while it runs (plan 2026-10-02, decision 9),
 * over either projection and drawn from the camera model, so it needs no
 * scene of its own: a guide line through the pivot along each axis the
 * transform is held to, in that axis's colour, and a readout of what it
 * does, what it is held to and its value — the typed text while there is
 * some. In 2D this is the badge an extrude shows its depth in.
 */
import { useSyncExternalStore } from "react";
import type { CanvasTransform } from "@kb/canvas";
import { projectPoint, type CanvasView, type ViewSize } from "./canvas-camera";
import type { CanvasCameraRig } from "./canvas-camera-rig";
import {
  transformGuides,
  transformReadout,
  type TransformGuide,
  type TransformInput,
} from "./canvas-transform-input";
import { AXIS_INK } from "./canvas-gizmo";

export interface CanvasTransformGuidesProps {
  /** The modal transform under way, and the transform its preview shows. */
  readonly input: TransformInput;
  readonly applied: CanvasTransform | null;
  readonly rig: CanvasCameraRig;
  /** The 3D scene is the one showing (otherwise the view is `flatView`). */
  readonly in3d: boolean;
  readonly flatView: CanvasView;
  readonly size: ViewSize;
}

/** How far a guide reaches each way from the pivot on screen, CSS pixels: past any viewport. */
const REACH = 6000;

/** A guide's line on screen, through the pivot; null where its axis points at the eye. */
function guideLine(view: CanvasView, size: ViewSize, input: TransformInput, guide: TransformGuide) {
  const { pivot } = input;
  const step = 100 / view.zoom;
  const a = projectPoint(view, size, pivot);
  const b = projectPoint(view, size, {
    x: pivot.x + guide.dir.x * step,
    y: pivot.y + guide.dir.y * step,
    z: pivot.z + guide.dir.z * step,
  });
  if (a === null || b === null) return null;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 1) return null;
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  return { x1: a.x - ux * REACH, y1: a.y - uy * REACH, x2: a.x + ux * REACH, y2: a.y + uy * REACH };
}

export function CanvasTransformGuides({
  input,
  applied,
  rig,
  in3d,
  flatView,
  size,
}: CanvasTransformGuidesProps) {
  const live = useSyncExternalStore(rig.subscribe, () => rig.view);
  const view = in3d ? live : flatView;
  const readout = transformReadout(input, applied, view);
  return (
    <>
      <svg className="pointer-events-none absolute inset-0 z-20 size-full overflow-hidden">
        {transformGuides(input).map((guide) => {
          const line = guideLine(view, size, input, guide);
          return line === null ? null : (
            <line
              key={guide.axis}
              data-testid={`canvas-transform-guide-${guide.axis}`}
              {...line}
              stroke={AXIS_INK[guide.axis]}
              strokeWidth={1.5}
              strokeOpacity={0.85}
            />
          );
        })}
      </svg>
      <div
        data-testid="canvas-transform-readout"
        role="status"
        className="pointer-events-none absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-baseline gap-2 rounded-lg border border-foreground/10 bg-popover/95 px-3 py-1.5 shadow-floating backdrop-blur-sm"
      >
        <span className="text-label font-medium text-foreground/80">{readout.verb}</span>
        {readout.held !== null && (
          <span className="text-label text-foreground/50">{readout.held}</span>
        )}
        <span className="text-label text-foreground tabular-nums">{readout.value}</span>
        <span className="text-label text-foreground/40">
          {input.mode === "extrude" ? "" : "X Y Z · ⇧ plane · "}type · ↵ · Esc
        </span>
      </div>
    </>
  );
}
