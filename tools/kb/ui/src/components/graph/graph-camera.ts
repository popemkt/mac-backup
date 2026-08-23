import type Sigma from "sigma";
import type { CameraState } from "sigma/types";

const EASE_DURATION_MS = 300;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function animateCamera(
  sigma: Sigma,
  target: Partial<CameraState>,
  durationMs = EASE_DURATION_MS,
): void {
  const camera = sigma.getCamera();
  const start = camera.getState();
  const startTime = performance.now();

  const tx = target.x ?? start.x;
  const ty = target.y ?? start.y;
  const tRatio = target.ratio ?? start.ratio;
  const tAngle = target.angle ?? start.angle;

  function frame() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(1, elapsed / durationMs);
    const e = easeOutCubic(t);

    camera.setState({
      x: start.x + (tx - start.x) * e,
      y: start.y + (ty - start.y) * e,
      ratio: start.ratio + (tRatio - start.ratio) * e,
      angle: start.angle + (tAngle - start.angle) * e,
    });

    if (t < 1) requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Camera coordinates live in sigma's *framed* space — the graph normalized into
 * roughly [0,1]², which is why `resetCamera` targets {0.5, 0.5, ratio: 1} and
 * shows everything. Raw `graph.getNodeAttributes()` coordinates are post-layout
 * values on the order of ±10²–10³; feeding those to the camera parks the
 * viewport hundreds of graph-widths away from the data and paints a blank
 * canvas. Read framed coordinates through `getNodeDisplayData` instead.
 */
export function framedPoints(sigma: Sigma): Point[] {
  const points: Point[] = [];
  sigma.getGraph().forEachNode((id) => {
    const display = sigma.getNodeDisplayData(id);
    if (!display) return;
    const { x, y } = display;
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  });
  return points;
}

/**
 * The camera's visible extent in framed space is its `ratio` (ratio 1 shows the
 * whole normalized square), so covering a span with padding on each side needs
 * `ratio = span / (1 - 2 * padding)`.
 */
export function computeFitTarget(
  points: readonly Point[],
  padding = 0.1,
): Partial<CameraState> | null {
  if (points.length === 0) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;

  const usable = Math.max(0.05, 1 - padding * 2);
  const span = Math.max(maxX - minX, maxY - minY);
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    // A single node has zero span; keep it readable rather than infinitely zoomed.
    ratio: Math.max(0.05, span / usable),
  };
}

export function fitView(sigma: Sigma, padding = 0.1, durationMs = 300): void {
  const target = computeFitTarget(framedPoints(sigma), padding);
  // No display data yet (fit raced the first render) — the reset framing at
  // least shows the graph instead of blanking the canvas.
  if (!target) {
    if (sigma.getGraph().order > 0) resetCamera(sigma);
    return;
  }
  animateCamera(sigma, target, durationMs);
}

export function zoomIn(sigma: Sigma): void {
  const cam = sigma.getCamera().getState();
  animateCamera(sigma, { ratio: cam.ratio * 0.7 });
}

export function zoomOut(sigma: Sigma): void {
  const cam = sigma.getCamera().getState();
  animateCamera(sigma, { ratio: cam.ratio * 1.4 });
}

export function resetCamera(sigma: Sigma): void {
  animateCamera(sigma, { x: 0.5, y: 0.5, ratio: 1, angle: 0 });
}

export function focusNode(sigma: Sigma, nodeId: string): void {
  if (!sigma.getGraph().hasNode(nodeId)) return;
  // Framed space, for the same reason as fitView — raw attributes blank the view.
  const display = sigma.getNodeDisplayData(nodeId);
  if (!display) return;
  animateCamera(sigma, { x: display.x, y: display.y, ratio: 0.3 }, 400);
}
