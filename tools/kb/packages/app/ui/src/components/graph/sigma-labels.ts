import type { Settings } from "sigma/settings";
import { fitGraphLabel, GRAPH_LABEL_FONT } from "@/lib/graph-label";
import { readTokenColor } from "@/lib/css-color";
import { reserveGraphLabel, type GraphLabelBox } from "@/lib/graph-label-layout";

const labelBoxes = new WeakMap<HTMLCanvasElement, GraphLabelBox[]>();
export function resetGraphLabels(canvas: HTMLCanvasElement): void {
  labelBoxes.delete(canvas);
}

/** Sigma's default hover plate is white; own label paint for both 2D views. */
export const drawGraphLabel: Settings["defaultDrawNodeLabel"] = (ctx, data, settings) => {
  if (data.label === null || data.label.length === 0) return;
  ctx.font = `${settings.labelSize}px ${GRAPH_LABEL_FONT}`;
  const text = fitGraphLabel(
    data.label,
    (value) => ctx.measureText(value).width,
    Math.max(60, Math.min(220, ctx.canvas.width / (window.devicePixelRatio || 1) - 24)),
  );
  const width = ctx.measureText(text).width;
  const viewportWidth = ctx.canvas.width / (window.devicePixelRatio || 1);
  const x = Math.max(8, Math.min(data.x + data.size + 6, viewportWidth - width - 8));
  const viewportHeight = ctx.canvas.height / (window.devicePixelRatio || 1);
  const y = Math.max(16, Math.min(data.y + settings.labelSize / 3, viewportHeight - 6));
  const box = {
    x: x - 3,
    y: y - settings.labelSize - 2,
    width: width + 8,
    height: settings.labelSize + 7,
  };
  const boxes = labelBoxes.get(ctx.canvas) ?? [];
  if (ctx.canvas.classList.contains("sigma-labels") && !reserveGraphLabel(box, boxes)) return;
  labelBoxes.set(ctx.canvas, boxes);
  ctx.fillStyle = readTokenColor("--background", { fallback: "#fff" });
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = readTokenColor("--foreground", { fallback: "#222" });
  ctx.fillText(text, x, y);
};

export const drawGraphHover: Settings["defaultDrawNodeHover"] = (ctx, data, settings) => {
  ctx.beginPath();
  ctx.arc(data.x, data.y, data.size + 3, 0, Math.PI * 2);
  ctx.strokeStyle = readTokenColor("--foreground", { fallback: "#222" });
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawGraphLabel(ctx, data, settings);
};
