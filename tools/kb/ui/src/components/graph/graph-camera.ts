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

export function fitView(sigma: Sigma, padding = 0.1, durationMs = 300): void {
  const graph = sigma.getGraph();
  if (graph.order === 0) return;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  graph.forEachNode((_id, attrs) => {
    const x = Number(attrs.x);
    const y = Number(attrs.y);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });

  if (!Number.isFinite(minX)) return;

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const graphToViewport = sigma.graphToViewport({ x: minX, y: minY });
  const graphToViewport2 = sigma.graphToViewport({ x: maxX, y: maxY });
  const { width, height } = sigma.getDimensions();

  const spanX = Math.abs(graphToViewport2.x - graphToViewport.x);
  const spanY = Math.abs(graphToViewport2.y - graphToViewport.y);

  const currentRatio = sigma.getCamera().getState().ratio;
  const ratioX = spanX > 0 ? (width * (1 - padding * 2)) / spanX : 1;
  const ratioY = spanY > 0 ? (height * (1 - padding * 2)) / spanY : 1;
  const scale = Math.min(ratioX, ratioY);
  const targetRatio = currentRatio / scale;

  animateCamera(
    sigma,
    { x: cx, y: cy, ratio: Math.max(0.001, targetRatio) },
    durationMs,
  );
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
  const graph = sigma.getGraph();
  if (!graph.hasNode(nodeId)) return;
  const attrs = graph.getNodeAttributes(nodeId);
  animateCamera(sigma, { x: attrs.x, y: attrs.y, ratio: 0.3 }, 400);
}
