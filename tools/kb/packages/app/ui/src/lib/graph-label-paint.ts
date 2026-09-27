/**
 * A graph label, painted on a canvas in a theme's label style: the face,
 * weight, case and tracking it is set in, and the halo that keeps it legible
 * over the links and nodes behind it. Every renderer that paints its labels
 * on a canvas paints them here — the 3D graph into a sprite's texture, the
 * 2D graphs onto sigma's label layer — so a style reads the same wherever
 * it is drawn (DESIGN-UI → Graph → Graph themes).
 */
import { graphLabelFont, type GraphLabelFace } from "@/lib/graph-label";

/** How a theme sets its labels. */
export interface GraphLabelStyle {
  readonly face: GraphLabelFace;
  readonly weight: number;
  /** Set in capitals, and tracked this many CSS pixels apart. */
  readonly upper: boolean;
  readonly tracking: number;
  /** What keeps a label legible over the scene behind it. */
  readonly halo: "soft" | "stroke" | "plate" | "frost";
  /** Above its node's silhouette, or right of it, as a row's text stands beside its bullet. */
  readonly placement: "above" | "right";
}

/** A label's height, and the space either side of its text, in CSS pixels. */
export const GRAPH_LABEL_HEIGHT = 24;
export const GRAPH_LABEL_PAD = 6;

/** The colours a label is painted in: its text, and the ground its halo is made of. */
export interface GraphLabelInk {
  readonly text: string;
  readonly ground: string;
}

/** Set `ctx` to type a label in `style` at `size` CSS pixels. */
export function setGraphLabelType(
  ctx: CanvasRenderingContext2D,
  style: GraphLabelStyle,
  size: number,
): void {
  ctx.font = `${style.weight} ${size}px ${graphLabelFont(style.face)}`;
  ctx.letterSpacing = `${style.tracking}px`;
}

/** A label's text as its style sets it. */
export function graphLabelText(text: string, style: GraphLabelStyle): string {
  return style.upper ? text.toUpperCase() : text;
}

type Halo = (
  ctx: CanvasRenderingContext2D,
  label: string,
  at: { readonly x: number; readonly y: number; readonly width: number },
  ink: GraphLabelInk,
) => void;

/**
 * What keeps a label legible, drawn round text that starts at `x` and is
 * centred on `y`, in a box `width` wide (the text and its padding).
 */
const HALOS: Record<GraphLabelStyle["halo"], Halo> = {
  // The ground, drawn wide and soft under the text.
  soft: (ctx, label, { x, y }, ink) => {
    ctx.strokeStyle = ink.ground;
    ctx.lineWidth = 4;
    ctx.shadowColor = ink.ground;
    ctx.shadowBlur = 6;
    ctx.strokeText(label, x, y);
    ctx.shadowBlur = 0;
  },
  // A crisp, thin line of the ground: a row's text needs no more.
  stroke: (ctx, label, { x, y }, ink) => {
    ctx.strokeStyle = ink.ground;
    ctx.lineWidth = 3;
    ctx.strokeText(label, x, y);
  },
  // A solid plate of the ground under an ink rule: a printed caption.
  plate: (ctx, _label, { x, y, width }, ink) => {
    ctx.fillStyle = ink.ground;
    ctx.strokeStyle = ink.text;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.roundRect(
      x - GRAPH_LABEL_PAD + 1.5,
      y - GRAPH_LABEL_HEIGHT / 2 + 3.5,
      width - 3,
      GRAPH_LABEL_HEIGHT - 7,
      2,
    );
    ctx.fill();
    ctx.stroke();
  },
  // A rounded chip of the ground, translucent: frosted glass.
  frost: (ctx, _label, { x, y, width }, ink) => {
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = ink.ground;
    ctx.beginPath();
    ctx.roundRect(
      x - GRAPH_LABEL_PAD + 1,
      y - GRAPH_LABEL_HEIGHT / 2 + 3,
      width - 2,
      GRAPH_LABEL_HEIGHT - 6,
      (GRAPH_LABEL_HEIGHT - 6) / 2,
    );
    ctx.fill();
    ctx.globalAlpha = 1;
  },
};

/**
 * Paint `label` (already fitted and cased) starting at `x`, centred on `y`,
 * in a box `width` wide, under its style's halo. The context is typed for
 * the style already (`setGraphLabelType`); what the halo changes is restored.
 */
export function paintGraphLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  at: { readonly x: number; readonly y: number; readonly width: number },
  style: GraphLabelStyle,
  ink: GraphLabelInk,
): void {
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  HALOS[style.halo](ctx, label, at, ink);
  ctx.fillStyle = ink.text;
  ctx.fillText(label, at.x, at.y);
  ctx.restore();
}
