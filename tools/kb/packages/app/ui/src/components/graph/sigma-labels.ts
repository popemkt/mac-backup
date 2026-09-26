import type { Settings } from "sigma/settings";
import { fitGraphLabel } from "@/lib/graph-label";
import { readTokenColor } from "@/lib/css-color";
import {
  byLabelPriority,
  overlapsGraphLabel,
  reserveGraphLabel,
  type GraphLabelBox,
} from "@/lib/graph-label-layout";

type LabelData = Parameters<Settings["defaultDrawNodeLabel"]>[1];
type LabelSettings = Parameters<Settings["defaultDrawNodeLabel"]>[2];

/**
 * One frame's label layout, shared by the canvases that draw it (sigma's
 * label pass, then its hover pass): the drawn nodes' boxes, sampled once on
 * first use by either, the labels the label pass asked for, and the boxes
 * placed so far.
 *
 * Sigma asks for labels cell by cell, not by importance, so the label pass
 * only collects its requests; `placeGraphLabels` (after sigma has drawn)
 * places them in the shared priority order (`byLabelPriority`), each beside
 * its node, clear of nodes, of what the frame reserved first (a cluster's
 * title) and of every label placed before it.
 */
interface LabelFrame {
  readonly sample: (out: GraphLabelBox[]) => void;
  nodes: GraphLabelBox[] | null;
  /** The boxes taken so far: the nodes, reserved titles, then each placed label. */
  placed: GraphLabelBox[] | null;
  readonly requests: { ctx: CanvasRenderingContext2D; data: LabelData; settings: LabelSettings }[];
}
const frames = new WeakMap<HTMLCanvasElement, LabelFrame>();

function nodesOf(frame: LabelFrame): GraphLabelBox[] {
  if (frame.nodes === null) {
    const nodes: GraphLabelBox[] = [];
    frame.sample(nodes);
    frame.nodes = nodes;
  }
  return frame.nodes;
}

function placedOf(frame: LabelFrame): GraphLabelBox[] {
  frame.placed ??= [...nodesOf(frame)];
  return frame.placed;
}

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
  canvases: Iterable<HTMLCanvasElement>,
  sampleNodes: (out: GraphLabelBox[]) => void,
): void {
  const frame: LabelFrame = { sample: sampleNodes, nodes: null, placed: null, requests: [] };
  for (const canvas of canvases) frames.set(canvas, frame);
}

/** Take `box` for this frame's labels (a cluster's title); false when it is taken. */
export function reserveInGraphLabels(canvas: HTMLCanvasElement, box: GraphLabelBox): boolean {
  const frame = frames.get(canvas);
  return frame === undefined || reserveGraphLabel(box, placedOf(frame));
}

function measured(ctx: CanvasRenderingContext2D, data: LabelData, settings: LabelSettings) {
  ctx.font = `${settings.labelSize}px ${settings.labelFont}`;
  const dpr = window.devicePixelRatio || 1;
  const viewportWidth = ctx.canvas.width / dpr;
  const viewportHeight = ctx.canvas.height / dpr;
  const text = fitGraphLabel(
    data.label ?? "",
    (value) => ctx.measureText(value).width,
    Math.max(60, Math.min(220, viewportWidth - 24)),
  );
  const width = ctx.measureText(text).width;
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
  return { text, y, boxAt, places };
}

function paint(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
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
}

/** Sigma's default hover plate is white; own label paint for both 2D views. */
export const drawGraphLabel: Settings["defaultDrawNodeLabel"] = (ctx, data, settings) => {
  if (data.label === null || data.label.length === 0) return;
  const frame = frames.get(ctx.canvas);
  if (frame !== undefined && ctx.canvas.classList.contains("sigma-labels")) {
    // The label pass: placed later, in priority order.
    frame.requests.push({ ctx, data, settings });
    return;
  }
  const { text, y, boxAt, places } = measured(ctx, data, settings);
  let x = places[0] ?? 8;
  if (frame !== undefined) {
    // The hover pass: always drawn, on whichever side is clear of other nodes.
    const nodes = nodesOf(frame);
    x = places.find((at) => !overlapsGraphLabel(boxAt(at), nodes)) ?? x;
  }
  paint(ctx, text, x, y);
};

/** A label's rank: sigma hands the node's own attributes through, `degree` among them. */
function rankOf(data: LabelData) {
  return {
    id: data.key,
    degree: "degree" in data && typeof data.degree === "number" ? data.degree : 0,
    focus: data.highlighted === true ? 1 : 0,
  };
}

/**
 * Place and draw this frame's requested labels on `canvas`, in priority
 * order: beside the node, clear of nodes and of what is placed already, or
 * not at all.
 */
export function placeGraphLabels(canvas: HTMLCanvasElement): void {
  const frame = frames.get(canvas);
  if (frame === undefined || frame.requests.length === 0) return;
  const requests = frame.requests
    .splice(0)
    .toSorted((a, b) => byLabelPriority(rankOf(a.data), rankOf(b.data)));
  const boxes = placedOf(frame);
  for (const { ctx, data, settings } of requests) {
    const { text, y, boxAt, places } = measured(ctx, data, settings);
    const free = places.find((at) => reserveGraphLabel(boxAt(at), boxes));
    if (free !== undefined) paint(ctx, text, free, y);
  }
}

export const drawGraphHover: Settings["defaultDrawNodeHover"] = (ctx, data, settings) => {
  ctx.beginPath();
  ctx.arc(data.x, data.y, data.size + 3, 0, Math.PI * 2);
  ctx.strokeStyle = labelInk().text;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawGraphLabel(ctx, data, settings);
};
