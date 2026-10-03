/**
 * A canvas card painted onto a 2D canvas: what the 3D projection shows as
 * the card's face, so a card in depth reads as the card it is in 2D — its
 * text, its bullet and tags, its shape and colour — rather than as a box.
 *
 * The look is read from the design-system tokens at paint time (a canvas
 * cannot hold a `var()`), with the same roles the DOM cards use: the page
 * ground for the face, `--foreground` at the opacity ladder's steps for ink
 * and hairlines, `--primary` for the selection, the JSON Canvas presets for
 * shape colour, and the UI face at the body and UI steps for text.
 */
import {
  isGroupNode,
  isKbNode,
  isShapeNode,
  isTextNode,
  shapeOutline,
  tracePath,
  type CanvasNode,
  type CanvasShapeKind,
} from "@kb/canvas";
import { CANVAS_COLOR_PRESETS, type CanvasColorPresetId } from "./canvas-color";
import {
  type ColorToken,
  graphDisplayText,
  graphLabelFont,
  hasText,
  type OutlineNode,
  readTokenColor,
  toRenderableColor,
  wrapGraphLabel,
} from "@/sdk";

/** What a card shows, independent of how it is drawn. */
export type CardFace =
  | {
      readonly kind: "note";
      readonly text: string;
      readonly tags: readonly { readonly name: string; readonly color: string }[];
    }
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "shape";
      readonly shape: CanvasShapeKind;
      readonly label: string;
      readonly color: string | undefined;
    }
  | { readonly kind: "group"; readonly label: string }
  | { readonly kind: "missing"; readonly label: string }
  | { readonly kind: "other"; readonly label: string };

export function cardFaceOf(item: CanvasNode, nodes: ReadonlyMap<string, OutlineNode>): CardFace {
  if (isKbNode(item)) {
    const node = nodes.get(item.nodeId);
    if (node === undefined) return { kind: "missing", label: `missing ${item.nodeId}` };
    const text = graphDisplayText(node.text, (id) => nodes.get(id)?.text);
    return { kind: "note", text, tags: node.tags.map((t) => ({ name: t.name, color: t.color })) };
  }
  if (isTextNode(item)) return { kind: "text", text: item.text };
  if (isShapeNode(item)) {
    return { kind: "shape", shape: item.shape, label: item.label ?? "", color: item.color };
  }
  if (isGroupNode(item)) return { kind: "group", label: item.label ?? "" };
  return { kind: "other", label: item.type };
}

/** The tokens a card face is painted with, resolved to colours and pixels. */
export interface CardLook {
  readonly face: string;
  readonly ink: string;
  readonly primary: string;
  readonly danger: string;
  /** The JSON Canvas presets by id ("1"–"6"). */
  readonly presets: Readonly<Record<string, string>>;
  readonly font: string;
  /** The body step (a note's text), the UI step (text cards, shape labels), the label step. */
  readonly body: number;
  readonly ui: number;
  readonly label: number;
  /** `rounded-xl`, the card radius, and `rounded-md`, a shape's. */
  readonly radius: number;
  readonly shapeRadius: number;
}

/** A length token resolved by the browser (calc and var included), or the fallback. */
function probeLength(property: "fontSize" | "borderTopLeftRadius", css: string, fallback: number) {
  const view = typeof document === "undefined" ? null : document.defaultView;
  if (view === null) return fallback;
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  if (property === "fontSize") probe.style.fontSize = css;
  else probe.style.borderRadius = css;
  document.documentElement.appendChild(probe);
  const value = Number.parseFloat(view.getComputedStyle(probe)[property]);
  probe.remove();
  return Number.isFinite(value) ? value : fallback;
}

/** The corner radii an outline is rounded by, pixels: `rounded-xl` a card's, `rounded-md` a shape's. */
type CornerRadii = Pick<CardLook, "radius" | "shapeRadius">;

let radiiRead: { readonly skin: string | null; readonly radii: CornerRadii } | undefined;

/**
 * The corner radii, as the design system that is showing sets them: read
 * once per skin (`data-theme`), since only a skin changes a radius.
 */
export function readCornerRadii(): CornerRadii {
  const skin =
    typeof document === "undefined" ? null : document.documentElement.getAttribute("data-theme");
  if (radiiRead === undefined || radiiRead.skin !== skin) {
    radiiRead = {
      skin,
      radii: {
        radius: probeLength("borderTopLeftRadius", "var(--radius-xl)", 18),
        shapeRadius: probeLength("borderTopLeftRadius", "var(--radius-md)", 8),
      },
    };
  }
  return radiiRead.radii;
}

/**
 * The radius an item's outline is rounded by in both projections
 * (`shapeOutline`): a shape's and a frame's, or a card's for any other item.
 */
export function cornerRadius(item: CanvasNode, radii: CornerRadii): number {
  return isShapeNode(item) || isGroupNode(item) ? radii.shapeRadius : radii.radius;
}

/** Each JSON Canvas preset's token (`components/canvas/canvas-color` paints the same ones in the DOM). */
const PRESET_TOKENS = {
  "1": "--canvas-color-1",
  "2": "--canvas-color-2",
  "3": "--canvas-color-3",
  "4": "--canvas-color-4",
  "5": "--canvas-color-5",
  "6": "--canvas-color-6",
} as const satisfies Record<CanvasColorPresetId, ColorToken>;

export function readCardLook(): CardLook {
  const presets: Record<string, string> = {};
  for (const { id } of CANVAS_COLOR_PRESETS) presets[id] = readTokenColor(PRESET_TOKENS[id]);
  return {
    face: readTokenColor("--background"),
    ink: readTokenColor("--foreground"),
    primary: readTokenColor("--primary"),
    danger: readTokenColor("--destructive"),
    presets,
    font: graphLabelFont("ui"),
    body: probeLength("fontSize", "var(--type-body)", 14.5),
    ui: probeLength("fontSize", "var(--type-ui)", 13),
    label: probeLength("fontSize", "var(--type-label)", 11),
    ...readCornerRadii(),
  };
}

/** A colour at `alpha`; a colour the parser does not know is painted as it is. */
function alpha(color: string, amount: number): string {
  return toRenderableColor(color, amount) ?? color;
}

function channels(color: string): [number, number, number] | null {
  const match = /(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/.exec(
    toRenderableColor(color) ?? "",
  );
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * `color` at `amount` laid over the card face, composited in sRGB the way the
 * DOM does, and opaque. The GPU blends a translucent texel in linear light,
 * which turns a faint dark hairline fainter and a faint light wash brighter;
 * a colour that is already composited reads the same in both projections.
 */
export function over(look: CardLook, color: string, amount: number): string {
  const base = channels(look.face);
  const top = channels(color);
  if (base === null || top === null) return alpha(color, amount);
  const mix = (i: 0 | 1 | 2) => Math.round(base[i] + (top[i] - base[i]) * amount);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}

/** How much room around a card its face texture keeps for the ring and the shadow, px. */
export const FACE_MARGIN = 14;

interface FaceBox {
  readonly width: number;
  readonly height: number;
  readonly selected: boolean;
}

type Ctx = CanvasRenderingContext2D;

function roundedRect(ctx: Ctx, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, Math.min(r, w / 2, h / 2));
}

/** A raised card: its shadow, face, hairline, and the selection ring when selected. */
function paintSurface(ctx: Ctx, box: FaceBox, look: CardLook, fill: string, radius: number) {
  ctx.save();
  ctx.shadowColor = alpha(look.ink, 0.1);
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  roundedRect(ctx, box.width, box.height, radius);
  ctx.fillStyle = look.face;
  ctx.fill();
  ctx.restore();
  roundedRect(ctx, box.width, box.height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  paintOutline(ctx, box, look, radius, over(look, look.ink, 0.12));
}

function paintOutline(ctx: Ctx, box: FaceBox, look: CardLook, radius: number, stroke: string) {
  if (box.selected) {
    ctx.save();
    ctx.translate(-3, -3);
    roundedRect(ctx, box.width + 6, box.height + 6, radius + 3);
    ctx.lineWidth = 4;
    ctx.strokeStyle = over(look, look.primary, 0.16);
    ctx.stroke();
    ctx.restore();
  }
  roundedRect(ctx, box.width, box.height, radius);
  ctx.lineWidth = box.selected ? 1.5 : 1;
  ctx.strokeStyle = box.selected ? over(look, look.primary, 0.75) : stroke;
  ctx.stroke();
}

/**
 * Lines of `text` wrapped to `width`, paragraphs kept, at most `max` lines
 * (the last one ellipsised when text is left over).
 */
function wrapText(ctx: Ctx, text: string, width: number, max: number): string[] {
  const measure = (s: string) => ctx.measureText(s).width;
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") lines.push("");
    else lines.push(...wrapGraphLabel(paragraph, measure, width));
  }
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, Math.max(1, max));
  const last = kept.length - 1;
  let tail = `${kept[last] ?? ""}…`;
  while (tail.length > 1 && measure(tail) > width) tail = `${tail.slice(0, -2)}…`;
  kept[last] = tail;
  return kept;
}

function setFont(ctx: Ctx, look: CardLook, size: number, weight = 400): void {
  ctx.font = `${weight} ${size}px ${look.font}`;
}

/** Tag chips right-aligned on the first line; returns how much of the line they took. */
function paintTags(
  ctx: Ctx,
  tags: readonly { readonly name: string; readonly color: string }[],
  { right, top, line }: { readonly right: number; readonly top: number; readonly line: number },
  look: CardLook,
): number {
  setFont(ctx, look, look.label, 500);
  let x = right;
  const h = Math.min(line - 4, look.label + 7);
  for (const tag of tags.toReversed()) {
    const w = ctx.measureText(tag.name).width + 12;
    x -= w;
    ctx.beginPath();
    ctx.roundRect(x, top + (line - h) / 2, w, h, 6);
    ctx.fillStyle = over(look, tag.color, 0.13);
    ctx.fill();
    ctx.fillStyle = tag.color;
    ctx.textBaseline = "middle";
    ctx.fillText(tag.name, x + 6, top + line / 2 + 0.5);
    x -= 4;
  }
  return right - x;
}

function paintLines(ctx: Ctx, lines: readonly string[], x: number, top: number, line: number) {
  ctx.textBaseline = "middle";
  lines.forEach((text, i) => ctx.fillText(text, x, top + line * i + line / 2));
}

const PAD = 12;

function paintNote(
  ctx: Ctx,
  face: Extract<CardFace, { kind: "note" }>,
  box: FaceBox,
  look: CardLook,
) {
  paintSurface(ctx, box, look, look.face, look.radius);
  const line = look.body * 1.6;
  const bulletX = PAD + 8;
  const textX = PAD + 20;
  const taken =
    face.tags.length > 0
      ? paintTags(ctx, face.tags, { right: box.width - PAD, top: PAD, line }, look)
      : 0;
  const tint = face.tags[0]?.color;
  ctx.beginPath();
  ctx.arc(bulletX, PAD + line / 2, 3, 0, Math.PI * 2);
  ctx.fillStyle = tint ?? over(look, look.ink, 0.45);
  ctx.fill();
  setFont(ctx, look, look.body);
  const width = box.width - textX - PAD - (taken > 0 ? taken + 6 : 0);
  const max = Math.max(1, Math.floor((box.height - PAD * 2) / line));
  const text = hasText(face.text) ? face.text : "untitled";
  ctx.fillStyle = over(look, look.ink, hasText(face.text) ? 0.85 : 0.3);
  paintLines(ctx, wrapText(ctx, text, Math.max(20, width), max), textX, PAD, line);
}

function paintText(
  ctx: Ctx,
  face: Extract<CardFace, { kind: "text" }>,
  box: FaceBox,
  look: CardLook,
) {
  paintSurface(ctx, box, look, look.face, look.radius);
  setFont(ctx, look, look.ui);
  const line = look.ui * 1.5;
  const max = Math.max(1, Math.floor((box.height - PAD * 2) / line));
  ctx.fillStyle = over(look, look.ink, 0.85);
  paintLines(ctx, wrapText(ctx, face.text, box.width - PAD * 2, max), PAD, PAD, line);
}

function shapePath(ctx: Ctx, shape: CanvasShapeKind, box: FaceBox, radius: number): void {
  ctx.beginPath();
  tracePath(ctx, shapeOutline(shape, box.width, box.height, radius));
}

function paintShape(
  ctx: Ctx,
  face: Extract<CardFace, { kind: "shape" }>,
  box: FaceBox,
  look: CardLook,
) {
  const color = face.color === undefined ? undefined : (look.presets[face.color] ?? face.color);
  shapePath(ctx, face.shape, box, look.shapeRadius);
  ctx.fillStyle = look.face;
  ctx.fill();
  ctx.fillStyle = color === undefined ? over(look, look.ink, 0.02) : over(look, color, 0.14);
  ctx.fill();
  ctx.lineWidth = box.selected ? 2 : 1.5;
  ctx.strokeStyle = box.selected
    ? over(look, look.primary, 0.75)
    : color === undefined
      ? over(look, look.ink, 0.18)
      : color;
  ctx.stroke();
  setFont(ctx, look, look.ui);
  const label = hasText(face.label) ? face.label : "Label";
  ctx.fillStyle = over(look, look.ink, hasText(face.label) ? 0.85 : 0.25);
  ctx.textAlign = "center";
  const lines = wrapText(ctx, label, box.width - PAD * 2.5, 3);
  const line = look.ui * 1.4;
  paintLines(ctx, lines, box.width / 2, box.height / 2 - (line * lines.length) / 2, line);
  ctx.textAlign = "left";
}

function paintGroup(
  ctx: Ctx,
  face: Extract<CardFace, { kind: "group" }>,
  box: FaceBox,
  look: CardLook,
) {
  // A shade firmer than the DOM frame's: a hairline this faint vanishes at a slant.
  roundedRect(ctx, box.width, box.height, look.shapeRadius);
  ctx.fillStyle = over(look, look.ink, 0.035);
  ctx.fill();
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = box.selected ? over(look, look.primary, 0.55) : over(look, look.ink, 0.24);
  ctx.stroke();
  ctx.setLineDash([]);
  if (!hasText(face.label)) return;
  setFont(ctx, look, look.label, 500);
  ctx.fillStyle = over(look, look.ink, 0.45);
  paintLines(ctx, [face.label], 8, 4, look.label * 1.8);
}

function paintPlain(ctx: Ctx, label: string, box: FaceBox, look: CardLook, ink: string) {
  paintSurface(ctx, box, look, look.face, look.radius);
  setFont(ctx, look, look.label);
  ctx.fillStyle = ink;
  paintLines(ctx, [label], PAD, PAD / 2, look.label * 1.8);
}

/** Paint `face` for a card of `box`'s size into `ctx`, whose origin is the card's corner. */
export function paintCardFace(ctx: Ctx, face: CardFace, box: FaceBox, look: CardLook): void {
  switch (face.kind) {
    case "note":
      paintNote(ctx, face, box, look);
      break;
    case "text":
      paintText(ctx, face, box, look);
      break;
    case "shape":
      paintShape(ctx, face, box, look);
      break;
    case "group":
      paintGroup(ctx, face, box, look);
      break;
    case "missing":
      paintPlain(ctx, face.label, box, look, look.danger);
      break;
    case "other":
      paintPlain(ctx, face.label, box, look, over(look, look.ink, 0.4));
      break;
    default:
      break;
  }
}
