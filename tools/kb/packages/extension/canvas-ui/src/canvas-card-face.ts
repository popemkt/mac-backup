/**
 * A canvas card painted onto a 2D canvas: what the 3D projection shows as
 * the card's face, so a card in depth reads as the card it is in 2D — its
 * text, its bullet and tags, its shape and colour — rather than as a box.
 *
 * The look is read from the design-system tokens at paint time (a canvas
 * cannot hold a `var()`), with the same roles the DOM cards use: the page
 * ground for the face, `--foreground` at the opacity ladder's steps for ink
 * and hairlines, `--primary` for the selection, the palette's tokens for an
 * item's colour, and the faces and type steps its style names. An item's
 * style reaches the painter as the 2D canvas reads it (`itemPaint`): its
 * fill, its outline's width and dash, and how its words are set.
 */
import {
  isFileNode,
  isGroupNode,
  isKbNode,
  isShapeNode,
  isTextNode,
  shapeOutline,
  tracePath,
  CANVAS_PALETTE,
  type CanvasFont,
  type CanvasNode,
  type CanvasPaint,
  type CanvasPaletteId,
  type CanvasShapeKind,
} from "@kb/canvas";
import { paletteToken } from "./canvas-color";
import { isPicture, type FacePicture } from "./canvas-face-pictures";
import {
  TEXT_ALIGNS,
  TYPE_STEPS,
  itemPaint,
  type CanvasTypeStep,
  type FONT_FACES,
  type ItemPaint,
  type WordsPaint,
} from "./canvas-style";
import {
  assetSrcUrl,
  graphDisplayText,
  graphLabelFont,
  hasText,
  readTokenColor,
  toRenderableColor,
  wrapGraphLabel,
  type ColorToken,
  type OutlineNode,
} from "@kb/ui-sdk";

/** What a card shows, independent of how it is drawn; `style` is how its look paints it. */
export type CardFace =
  | {
      readonly kind: "note";
      readonly text: string;
      readonly tags: readonly { readonly name: string; readonly color: string }[];
      readonly style: ItemPaint;
    }
  | { readonly kind: "text"; readonly text: string; readonly style: ItemPaint }
  | {
      readonly kind: "shape";
      readonly shape: CanvasShapeKind;
      readonly label: string;
      readonly style: ItemPaint;
    }
  | { readonly kind: "group"; readonly label: string; readonly style: ItemPaint }
  /** An image item's picture, from the asset its file names. */
  | { readonly kind: "image"; readonly src: string; readonly picture: FacePicture }
  | { readonly kind: "missing"; readonly label: string }
  | { readonly kind: "other"; readonly label: string };

/**
 * What `item` shows: a card its node's text and tags (`nodes`), an image the
 * picture at its asset's source (`picture`), anything else its own fields.
 */
export function cardFaceOf(
  item: CanvasNode,
  nodes: ReadonlyMap<string, OutlineNode>,
  picture: (src: string) => FacePicture,
): CardFace {
  if (isKbNode(item)) {
    const node = nodes.get(item.nodeId);
    if (node === undefined) return { kind: "missing", label: `missing ${item.nodeId}` };
    const text = graphDisplayText(node.text, (id) => nodes.get(id)?.text);
    const tags = node.tags.map((t) => ({ name: t.name, color: t.color }));
    return { kind: "note", text, tags, style: itemPaint(item) };
  }
  if (isTextNode(item)) return { kind: "text", text: item.text, style: itemPaint(item) };
  if (isShapeNode(item)) {
    return { kind: "shape", shape: item.shape, label: item.label ?? "", style: itemPaint(item) };
  }
  if (isGroupNode(item)) return { kind: "group", label: item.label ?? "", style: itemPaint(item) };
  if (isFileNode(item)) {
    if (!isPicture(item.file)) return { kind: "other", label: item.file };
    const src = assetSrcUrl(item.file);
    return { kind: "image", src, picture: picture(src) };
  }
  return { kind: "other", label: item.type };
}

/** The tokens a card face is painted with, resolved to colours and pixels. */
export interface CardLook {
  readonly face: string;
  readonly ink: string;
  readonly primary: string;
  readonly danger: string;
  /** The palette's colours by id (`CANVAS_PALETTE`); an entry missing is painted as no colour. */
  readonly palette: Readonly<Partial<Record<CanvasPaletteId, string>>>;
  /** The design system's faces, by the font a style names (`FONT_FACES`). */
  readonly faces: Readonly<Record<CanvasFont, string>>;
  /** The body step, a card's text: its node's words, set as the outline sets them. */
  readonly body: number;
  /** The type steps a style's sizes set words at (`TYPE_STEPS`), pixels. */
  readonly steps: Readonly<Record<CanvasTypeStep, number>>;
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

/** A paint as `look` colours it (the palette through its tokens), or undefined for none. */
export function paintColor(look: CardLook, paint: CanvasPaint | undefined): string | undefined {
  if (paint === undefined) return undefined;
  return paint.kind === "palette" ? look.palette[paint.id] : paint.css;
}

/** Each step's size as the browser resolves its token, with the default system's as fallback. */
const STEP_FALLBACK: Readonly<Record<CanvasTypeStep, number>> = {
  "--type-label": 11,
  "--type-ui": 13,
  "--type-heading": 18,
  "--type-title": 20,
};

/** Which of `graphLabelFont`'s faces each font's token is. */
const FONT_LABEL_FACE = { sans: "ui", serif: "serif", mono: "mono" } as const satisfies {
  readonly [F in keyof typeof FONT_FACES]: Parameters<typeof graphLabelFont>[0];
};

export function readCardLook(): CardLook {
  const palette: Partial<Record<CanvasPaletteId, string>> = {};
  for (const { id } of CANVAS_PALETTE) {
    const token: ColorToken = paletteToken(id);
    palette[id] = readTokenColor(token);
  }
  const steps = { ...STEP_FALLBACK };
  for (const step of Object.values(TYPE_STEPS)) {
    steps[step] = probeLength("fontSize", `var(${step})`, STEP_FALLBACK[step]);
  }
  return {
    face: readTokenColor("--background"),
    ink: readTokenColor("--foreground"),
    primary: readTokenColor("--primary"),
    danger: readTokenColor("--destructive"),
    palette,
    faces: {
      sans: graphLabelFont(FONT_LABEL_FACE.sans),
      serif: graphLabelFont(FONT_LABEL_FACE.serif),
      mono: graphLabelFont(FONT_LABEL_FACE.mono),
    },
    body: probeLength("fontSize", "var(--type-body)", 14.5),
    steps,
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

/** A raised card with no style of its own (a missing card, an unknown item): face and hairline. */
function paintSurface(ctx: Ctx, box: FaceBox, look: CardLook, radius: number) {
  ctx.save();
  ctx.shadowColor = alpha(look.ink, 0.1);
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  roundedRect(ctx, box.width, box.height, radius);
  ctx.fillStyle = look.face;
  ctx.fill();
  ctx.restore();
  paintOutline(ctx, box, look, radius, over(look, look.ink, 0.12));
}

/** How a chrome is painted: its outline's path, its ink when uncoloured, and whether it casts. */
interface ChromeSpec {
  readonly shape: CanvasShapeKind;
  readonly radius: number;
  /** How much of the foreground an uncoloured outline is drawn with, 0–1. */
  readonly ink: number;
  /** Whether a filled ground casts the card's soft shadow. */
  readonly raised: boolean;
}

/** How much of its colour a semi fill washes over the ground. */
const WASH = 0.14;

/** The colour an item's ground is filled with, or null for none. */
function groundOf(style: ItemPaint, look: CardLook): string | null {
  const color = paintColor(look, style.color);
  switch (style.chrome?.fill) {
    case "none":
    case undefined:
      return null;
    case "solid":
      return color ?? over(look, look.ink, 0.9);
    case "semi":
    default:
      return color === undefined ? look.face : over(look, color, WASH);
  }
}

/**
 * An item's chrome as its style says (`itemPaint`, as the 2D outline draws
 * it): its ground, filled and casting when raised, and its outline at its
 * width and dash, in its colour or the foreground at `spec.ink`; selected,
 * in the primary over a soft halo.
 */
function paintChrome(ctx: Ctx, style: ItemPaint, box: FaceBox, look: CardLook, spec: ChromeSpec) {
  const path = () => {
    ctx.beginPath();
    tracePath(ctx, shapeOutline(spec.shape, box.width, box.height, spec.radius));
  };
  const ground = groundOf(style, look);
  if (ground !== null) {
    ctx.save();
    if (spec.raised) {
      ctx.shadowColor = alpha(look.ink, 0.1);
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 2;
    }
    path();
    ctx.fillStyle = ground;
    ctx.fill();
    ctx.restore();
  }
  const outline = style.chrome?.outline ?? null;
  const color = paintColor(look, style.color);
  if (box.selected) {
    path();
    ctx.lineWidth = 6;
    ctx.strokeStyle = over(look, look.primary, 0.15);
    ctx.stroke();
  }
  if (outline === null && !box.selected) return;
  path();
  ctx.setLineDash(outline?.pattern ?? []);
  ctx.lineWidth = box.selected ? Math.max(2, outline?.width ?? 0) : (outline?.width ?? 0);
  ctx.strokeStyle = box.selected
    ? over(look, look.primary, 0.7)
    : (color ?? over(look, look.ink, spec.ink));
  ctx.stroke();
  ctx.setLineDash([]);
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

function setFont(ctx: Ctx, face: string, size: number, weight = 400): void {
  ctx.font = `${weight} ${size}px ${face}`;
}

/** Tag chips right-aligned on the first line; returns how much of the line they took. */
function paintTags(
  ctx: Ctx,
  tags: readonly { readonly name: string; readonly color: string }[],
  { right, top, line }: { readonly right: number; readonly top: number; readonly line: number },
  look: CardLook,
): number {
  const size = look.steps["--type-label"];
  setFont(ctx, look.faces.sans, size, 500);
  let x = right;
  const h = Math.min(line - 4, size + 7);
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

/** The ink words are set in: the ground's on a solid fill, the foreground's otherwise, at `amount`. */
function wordsInk(style: ItemPaint, look: CardLook, amount: number): string {
  if (style.chrome?.fill !== "solid") return over(look, look.ink, amount);
  return paintColor(look, style.color) === undefined ? look.face : alpha(look.face, amount);
}

/** Where words are set inside a box: its padding across and up and down, and the most lines. */
interface WordsBox {
  readonly padX: number;
  readonly padY: number;
  readonly leading: number;
  readonly max: number;
  readonly weight?: number;
}

/**
 * `text` set in `box` as `words` says: its face at its step, aligned across
 * the line (`TEXT_ALIGNS`, as the DOM aligns it) and placed up and down it,
 * wrapped to the box.
 */
function paintWords(
  ctx: Ctx,
  text: string,
  words: WordsPaint,
  ink: string,
  { box, look, at }: { box: FaceBox; look: CardLook; at: WordsBox },
): void {
  const size = look.steps[words.step];
  setFont(ctx, look.faces[words.font], size, at.weight);
  const line = size * at.leading;
  const room = box.height - at.padY * 2;
  const max = Math.max(1, Math.min(at.max, Math.floor(room / line)));
  const lines = wrapText(ctx, text, Math.max(20, box.width - at.padX * 2), max);
  const tall = line * lines.length;
  const top =
    words.valign === "top"
      ? at.padY
      : words.valign === "bottom"
        ? box.height - at.padY - tall
        : (box.height - tall) / 2;
  const align = TEXT_ALIGNS[words.align];
  const x = align === "left" ? at.padX : align === "right" ? box.width - at.padX : box.width / 2;
  ctx.fillStyle = ink;
  ctx.textAlign = align;
  paintLines(ctx, lines, x, top, line);
  ctx.textAlign = "left";
}

const PAD = 12;

function paintNote(
  ctx: Ctx,
  face: Extract<CardFace, { kind: "note" }>,
  box: FaceBox,
  look: CardLook,
) {
  paintChrome(ctx, face.style, box, look, {
    shape: "rect",
    radius: look.radius,
    ink: 0.12,
    raised: true,
  });
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
  setFont(ctx, look.faces.sans, look.body);
  const width = box.width - textX - PAD - (taken > 0 ? taken + 6 : 0);
  const max = Math.max(1, Math.floor((box.height - PAD * 2) / line));
  const text = hasText(face.text) ? face.text : "untitled";
  ctx.fillStyle = wordsInk(face.style, look, hasText(face.text) ? 0.85 : 0.3);
  paintLines(ctx, wrapText(ctx, text, Math.max(20, width), max), textX, PAD, line);
}

/** The words of an item that owns them, set by its style; nothing for one that does not. */
function paintOwnWords(
  ctx: Ctx,
  text: string,
  style: ItemPaint,
  ink: number,
  { box, look, at }: { box: FaceBox; look: CardLook; at: WordsBox },
): void {
  if (style.words === null) return;
  paintWords(ctx, text, style.words, wordsInk(style, look, ink), { box, look, at });
}

function paintText(
  ctx: Ctx,
  face: Extract<CardFace, { kind: "text" }>,
  box: FaceBox,
  look: CardLook,
) {
  paintChrome(ctx, face.style, box, look, {
    shape: "rect",
    radius: look.radius,
    ink: 0.12,
    raised: true,
  });
  paintOwnWords(ctx, face.text, face.style, 0.85, {
    box,
    look,
    at: { padX: PAD, padY: PAD, leading: 1.5, max: Infinity },
  });
}

function paintShape(
  ctx: Ctx,
  face: Extract<CardFace, { kind: "shape" }>,
  box: FaceBox,
  look: CardLook,
) {
  paintChrome(ctx, face.style, box, look, {
    shape: face.shape,
    radius: look.shapeRadius,
    ink: 0.18,
    raised: false,
  });
  const label = hasText(face.label) ? face.label : "Label";
  paintOwnWords(ctx, label, face.style, hasText(face.label) ? 0.85 : 0.25, {
    box,
    look,
    at: { padX: PAD * 1.25, padY: 8, leading: 1.4, max: 3 },
  });
}

function paintGroup(
  ctx: Ctx,
  face: Extract<CardFace, { kind: "group" }>,
  box: FaceBox,
  look: CardLook,
) {
  // A shade firmer than the DOM frame's: a hairline this faint vanishes at a slant.
  paintChrome(ctx, face.style, box, look, {
    shape: "rect",
    radius: look.shapeRadius,
    ink: 0.24,
    raised: false,
  });
  if (!hasText(face.label)) return;
  paintOwnWords(ctx, face.label, face.style, 0.45, {
    box,
    look,
    at: { padX: 8, padY: 4, leading: 1.8, max: 1, weight: 500 },
  });
}

/**
 * An image: its picture filling the card, cropped to cover it as the 2D
 * `<img>` is (`object-cover`), under the card's hairline; while it loads, or
 * when its asset is gone, a plain card saying so.
 */
function paintImage(
  ctx: Ctx,
  face: Extract<CardFace, { kind: "image" }>,
  box: FaceBox,
  look: CardLook,
) {
  const { picture } = face;
  if (picture.state !== "ready") {
    const label = picture.state === "missing" ? "missing image" : "";
    paintPlain(ctx, label, box, look, over(look, look.ink, 0.4));
    return;
  }
  const { naturalWidth: width, naturalHeight: height } = picture.image;
  const scale = Math.max(box.width / Math.max(1, width), box.height / Math.max(1, height));
  const [w, h] = [width * scale, height * scale];
  ctx.save();
  roundedRect(ctx, box.width, box.height, look.shapeRadius);
  ctx.fillStyle = look.face;
  ctx.fill();
  ctx.clip();
  ctx.drawImage(picture.image, (box.width - w) / 2, (box.height - h) / 2, w, h);
  ctx.restore();
  paintOutline(ctx, box, look, look.shapeRadius, over(look, look.ink, 0.12));
}

/** The words a face shows, as a standing label says them; an image says none. */
export function faceWords(face: CardFace): string {
  switch (face.kind) {
    case "note":
    case "text":
      return face.text;
    case "image":
      return "";
    case "shape":
    case "group":
    case "missing":
    case "other":
      return face.label;
    default:
      return "";
  }
}

/** The face a standing label's words are set in: its style's, or the UI face. */
export function faceFont(face: CardFace): CanvasFont {
  return "style" in face ? (face.style.words?.font ?? "sans") : "sans";
}

/**
 * A standing face's label (`faceStands`): `words` set in `font` at the UI
 * step, centred in a box of the face's size, on a pill of card stock so it
 * reads over whatever is behind it — a solid's body is its surface, so the
 * label paints no card. Selected, the pill wears the selection ring.
 * Nothing at all for no words.
 */
export function paintLabel(
  ctx: Ctx,
  words: string,
  box: FaceBox,
  look: CardLook,
  font: CanvasFont = "sans",
): void {
  if (!hasText(words)) return;
  const size = look.steps["--type-ui"];
  setFont(ctx, look.faces[font], size, 500);
  const line = size * 1.4;
  const lines = wrapText(ctx, words, box.width - PAD * 2, 3);
  const wide = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const pill = { width: Math.min(box.width, wide + PAD * 2), height: line * lines.length + PAD };
  ctx.save();
  ctx.translate((box.width - pill.width) / 2, (box.height - pill.height) / 2);
  roundedRect(ctx, pill.width, pill.height, pill.height / 2);
  ctx.fillStyle = alpha(look.face, 0.92);
  ctx.fill();
  paintOutline(
    ctx,
    { ...pill, selected: box.selected },
    look,
    pill.height / 2,
    over(look, look.ink, 0.14),
  );
  ctx.restore();
  ctx.fillStyle = over(look, look.ink, 0.88);
  ctx.textAlign = "center";
  paintLines(ctx, lines, box.width / 2, box.height / 2 - (line * lines.length) / 2, line);
  ctx.textAlign = "left";
}

function paintPlain(ctx: Ctx, label: string, box: FaceBox, look: CardLook, ink: string) {
  paintSurface(ctx, box, look, look.radius);
  const size = look.steps["--type-label"];
  setFont(ctx, look.faces.sans, size);
  ctx.fillStyle = ink;
  paintLines(ctx, [label], PAD, PAD / 2, size * 1.8);
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
    case "image":
      paintImage(ctx, face, box, look);
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
