import type { Settings } from "sigma/settings";
import { fitGraphLabel } from "@/lib/graph-label";
import { readTokenColor } from "@/lib/css-color";
import { reserveGraphLabel, type GraphLabelBox } from "@/lib/graph-label-layout";

/** A frame's label layout per canvas: the boxes placed so far, once sampled. */
const labelBoxes = new WeakMap<HTMLCanvasElement, GraphLabelBox[]>();
/** The node sampler to run before the frame's first label is placed. */
const pendingNodes = new WeakMap<HTMLCanvasElement, (out: GraphLabelBox[]) => void>();

/**
 * The label ink and its halo, read from the tokens once per appearance
 * (`setGraphLabelInk`) rather than once per label per frame: each token read
 * is a style recalculation.
 */
let ink: { text: string; halo: string } | null = null;
export function setGraphLabelInk(text: string, halo: string): void {
  ink = { text, halo };
}
function labelInk(): { text: string; halo: string } {
  ink ??= { text: readTokenColor("--foreground"), halo: readTokenColor("--background") };
  return ink;
}
/**
 * Start a frame's label layout. `sampleNodes` writes the drawn nodes' boxes:
 * a label is placed beside its node, never over another, so a label in a
 * dense cluster moves to its node's other side or is left out (collision
 * avoidance thins labels where nodes crowd).
 *
 * The sampler runs when the frame's first label is placed, not now. Sigma
 * announces a frame (`beforeRender`) before it re-processes node positions
 * and rebuilds its camera matrix; by the time it draws labels both are
 * current, so the boxes are this frame's, through a pan, a zoom or a layout
 * tick alike.
 */
export function resetGraphLabels(
  canvas: HTMLCanvasElement,
  sampleNodes: (out: GraphLabelBox[]) => void,
): void {
  labelBoxes.delete(canvas);
  pendingNodes.set(canvas, sampleNodes);
}

/** The canvas's placed boxes for this frame, the nodes sampled on first use. */
function placed(canvas: HTMLCanvasElement): GraphLabelBox[] {
  let boxes = labelBoxes.get(canvas);
  if (boxes === undefined) {
    boxes = [];
    pendingNodes.get(canvas)?.(boxes);
    pendingNodes.delete(canvas);
    labelBoxes.set(canvas, boxes);
  }
  return boxes;
}

/** Sigma's default hover plate is white; own label paint for both 2D views. */
export const drawGraphLabel: Settings["defaultDrawNodeLabel"] = (ctx, data, settings) => {
  if (data.label === null || data.label.length === 0) return;
  ctx.font = `${settings.labelSize}px ${settings.labelFont}`;
  const text = fitGraphLabel(
    data.label,
    (value) => ctx.measureText(value).width,
    Math.max(60, Math.min(220, ctx.canvas.width / (window.devicePixelRatio || 1) - 24)),
  );
  const width = ctx.measureText(text).width;
  const viewportWidth = ctx.canvas.width / (window.devicePixelRatio || 1);
  const viewportHeight = ctx.canvas.height / (window.devicePixelRatio || 1);
  const y = Math.max(16, Math.min(data.y + settings.labelSize / 3, viewportHeight - 6));
  const boxAt = (at: number) => ({
    x: at - 3,
    y: y - settings.labelSize - 2,
    width: width + 8,
    height: settings.labelSize + 7,
  });
  // Right of the node, else left of it; clamped into the frame.
  const places = [data.x + data.size + 6, data.x - data.size - 10 - width].map((at) =>
    Math.max(8, Math.min(at, viewportWidth - width - 8)),
  );
  let x = places[0] ?? 8;
  if (ctx.canvas.classList.contains("sigma-labels")) {
    const boxes = placed(ctx.canvas);
    const free = places.find((at) => reserveGraphLabel(boxAt(at), boxes));
    if (free === undefined) return;
    x = free;
  }
  // The halo: the ground, wide and soft under the text, so a label reads over
  // the links and nodes behind it.
  const { text: fill, halo } = labelInk();
  ctx.save();
  ctx.strokeStyle = halo;
  ctx.shadowColor = halo;
  ctx.shadowBlur = 6;
  ctx.lineWidth = 5;
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.restore();
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
};

export const drawGraphHover: Settings["defaultDrawNodeHover"] = (ctx, data, settings) => {
  ctx.beginPath();
  ctx.arc(data.x, data.y, data.size + 3, 0, Math.PI * 2);
  ctx.strokeStyle = labelInk().text;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawGraphLabel(ctx, data, settings);
};
