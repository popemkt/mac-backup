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
 * its node, clear of what the frame reserved first (a cluster's title), of
 * every label placed before it, and of every node at least as well connected.
 */
interface LabelFrame {
  readonly sample: (out: GraphNodeBox[]) => void;
  nodes: GraphNodeBox[] | null;
  /** The boxes taken so far: reserved titles, then each placed label. */
  readonly placed: GraphLabelBox[];
  readonly requests: { ctx: CanvasRenderingContext2D; data: LabelData; settings: LabelSettings }[];
}
const frames = new WeakMap<HTMLCanvasElement, LabelFrame>();

/** A drawn node's box, and how connected the node is. */
export interface GraphNodeBox extends GraphLabelBox {
  readonly degree: number;
}

function nodesOf(frame: LabelFrame): GraphNodeBox[] {
  if (frame.nodes === null) {
    const nodes: GraphNodeBox[] = [];
    frame.sample(nodes);
    frame.nodes = nodes;
  }
  return frame.nodes;
}

/**
 * Whether a label of a node with `degree` may take `box`: clear of every
 * label and title placed before it, and of every drawn node at least as well
 * connected. A label may cover a lesser node: a hub ringed by its leaves is
 * still named, over a leaf rather than not at all.
 */
function reserveFor(frame: LabelFrame, box: GraphLabelBox, degree: number): boolean {
  const blocking = nodesOf(frame).filter((node) => node.degree >= degree);
  return !overlapsGraphLabel(box, blocking) && reserveGraphLabel(box, frame.placed);
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
  sampleNodes: (out: GraphNodeBox[]) => void,
): void {
  const frame: LabelFrame = { sample: sampleNodes, nodes: null, placed: [], requests: [] };
  for (const canvas of canvases) frames.set(canvas, frame);
}

/** Take `box` for this frame's labels (a cluster's title); false when it is taken. */
export function reserveInGraphLabels(canvas: HTMLCanvasElement, box: GraphLabelBox): boolean {
  const frame = frames.get(canvas);
  return frame === undefined || reserveFor(frame, box, Infinity);
}

/** Where a label may stand: its baseline's start, and the box it covers. */
interface LabelPlace {
  readonly x: number;
  readonly y: number;
  readonly box: GraphLabelBox;
}

/**
 * A label's text, fitted, and the places it may stand, best first: right of
 * its node, left of it, then centred above and below it — a hub ringed by
 * its neighbours on both sides is still labelled over or under itself.
 * Every place is clamped into the frame.
 */
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
  const size = settings.labelSize;
  const clampX = (at: number) => Math.max(8, Math.min(at, viewportWidth - width - 8));
  const clampY = (at: number) => Math.max(16, Math.min(at, viewportHeight - 6));
  const place = (x: number, y: number): LabelPlace => ({
    x,
    y,
    box: { x: x - 3, y: y - size - 2, width: width + 8, height: size + 7 },
  });
  const beside = clampY(data.y + size / 3);
  const places: LabelPlace[] = [
    place(clampX(data.x + data.size + 6), beside),
    place(clampX(data.x - data.size - 10 - width), beside),
    place(clampX(data.x - width / 2), clampY(data.y - data.size - 6)),
    place(clampX(data.x - width / 2), clampY(data.y + data.size + size + 4)),
  ];
  return { text, places };
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
  const { text, places } = measured(ctx, data, settings);
  const first = places[0];
  if (first === undefined) return;
  // The hover pass: always drawn, wherever is clear of other nodes, else beside it.
  const nodes = frame === undefined ? [] : nodesOf(frame);
  const at = places.find((p) => !overlapsGraphLabel(p.box, nodes)) ?? first;
  paint(ctx, text, at.x, at.y);
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
  for (const { ctx, data, settings } of requests) {
    const { text, places } = measured(ctx, data, settings);
    const { degree } = rankOf(data);
    const free = places.find((p) => reserveFor(frame, p.box, degree));
    if (free !== undefined) paint(ctx, text, free.x, free.y);
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
