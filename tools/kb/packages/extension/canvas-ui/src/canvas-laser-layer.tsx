import { useEffect, useRef, useState, type RefObject } from "react";
import { laserSegments, liveLaserPoints, type LaserPoint } from "./canvas-laser";

/**
 * The laser drawn over the stage while frames are presented (`canvas-laser`):
 * every pointer move over the stage adds to the trail, and the trail is
 * drawn each frame until its last point has faded. It takes no pointer
 * itself, so the canvas under it is as it always is.
 */
export function CanvasLaserLayer({
  stage,
  on,
}: {
  readonly stage: RefObject<HTMLElement | null>;
  /** Frames are being presented: the pointer is a laser. */
  readonly on: boolean;
}) {
  const points = useRef<LaserPoint[]>([]);
  /** The trail as last drawn: its live points, and the moment they were read at. */
  const [trail, setTrail] = useState<{ points: readonly LaserPoint[]; now: number }>({
    points: [],
    now: 0,
  });
  useEffect(() => {
    const element = stage.current;
    if (!on || element === null) return undefined;
    let frame: number | null = null;
    const tick = () => {
      const at = performance.now();
      points.current = liveLaserPoints(points.current, at);
      setTrail({ points: points.current, now: at });
      frame = points.current.length > 0 ? requestAnimationFrame(tick) : null;
    };
    const move = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      const point = {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
        t: performance.now(),
      };
      points.current = [...points.current, point];
      frame ??= requestAnimationFrame(tick);
    };
    element.addEventListener("pointermove", move);
    return () => {
      element.removeEventListener("pointermove", move);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [stage, on]);
  const segments = on ? laserSegments(trail.points, trail.now) : [];
  if (segments.length === 0) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-30 h-full w-full text-destructive"
      data-testid="canvas-laser"
      aria-hidden
    >
      {segments.map(({ from, to, opacity }) => (
        <line
          key={`${String(from.t)}-${String(to.t)}`}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="currentColor"
          strokeWidth={4}
          strokeLinecap="round"
          opacity={opacity}
        />
      ))}
    </svg>
  );
}
