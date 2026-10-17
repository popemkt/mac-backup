/**
 * A canvas document painted as one standalone SVG (DESIGN.md → Canvas
 * documents → Export): the top view of every item and edge, painted from
 * the look both projections paint from (`itemPaint`, `edgePaint`, each tone
 * said as CSS by `toneCss`) and placed by the rules they place by
 * (`itemOutline`, `topFace`, `edgeRoute`, `edgeHead`, `paintOrder`), so the
 * export is what people see, and the look contract holds it to that.
 *
 * Colours, type steps and faces are said through the design tokens, as the
 * DOM says them; the SVG carries each token's default-system value in its
 * own `<style>`, so it renders anywhere, and a page that defines the tokens
 * repaints it in its own system. A picture is referenced by its asset path.
 */
import { COLOR_TOKEN_FALLBACKS } from "@kb/contracts";
import { boxBounds } from "./box.ts";
import {
  isFileNode,
  isGroupNode,
  isKbNode,
  isPictureFile,
  isShapeNode,
  isTextNode,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
} from "./doc.ts";
import { edgeHead, edgeRoute, routeMidpoint, routePoints } from "./edges.ts";
import { paintOrder } from "./membership.ts";
import {
  CARD_BODY_FALLBACK,
  CARD_BODY_STEP,
  CORNER_RADII_FALLBACKS,
  FONT_FACES,
  TONE_TOKENS,
  TYPE_STEPS,
  TYPE_STEP_FALLBACKS,
  cornerRadius,
  edgePaint,
  itemPaint,
  type ItemPaint,
  type Tone,
  type WordsPaint,
} from "./paint.ts";
import { paletteToken, toneCss } from "./paint-css.ts";
import { itemMarks, itemOutline } from "./paths.ts";
import { svgPathData, topFace } from "./shapes.ts";
import { CANVAS_PALETTE } from "./style.ts";
import { CANVAS_FONTS, type CanvasFont } from "./style-fields.ts";

/** What the painter reads beyond the document: a card's words, and whether an edge's link holds. */
export interface SvgSource {
  /** The words of the node a `kb-node` card shows; none when the store has no such node. */
  readonly textOf: (nodeId: string) => string | undefined;
  /** Whether an edge's native link still holds (`isNativeEdgeBound`); one that does not is faint. */
  readonly bound: (edge: CanvasEdge) => boolean;
}

/** The room kept around the drawing, canvas units. */
const MARGIN = 24;

/** How far words sit in from their box's sides and from its top and bottom, canvas units (`px-2 py-1`). */
const WORDS_INSET = { x: 8, y: 4 } as const;

/** A line of words is this many times its step tall. */
const LEADING = 1.3;

/** How wide a character is taken to be, in steps, to break words into lines. */
const CHARACTER_WIDTH = 0.55;

/** The generic face each font falls back to where its token is not defined. */
const FONT_FALLBACKS: { readonly [F in CanvasFont]: string } = {
  sans: "sans-serif",
  serif: "serif",
  mono: "monospace",
};

/** Where a block of words is anchored up and down, and the baseline that anchors it, per `valign`. */
const BASELINES = {
  top: "hanging",
  middle: "central",
  bottom: "text-after-edge",
} as const satisfies { readonly [V in WordsPaint["valign"]]: string };

/** The anchor along a line, per `align`: SVG names them as kb does. */
const ANCHORS = {
  start: "start",
  middle: "middle",
  end: "end",
} as const satisfies { readonly [A in WordsPaint["align"]]: string };

const round = (v: number) => Math.round(v * 100) / 100;

/** What XML 1.0 lets a document hold: tab, line feed, carriage return, and the characters from space up, surrogates and the two non-characters aside. */
const XML_FORBIDDEN = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

/** `text` as XML character data or an attribute value: escaped, and without what XML may not hold. */
function escapeXml(text: string): string {
  return text
    .replaceAll(XML_FORBIDDEN, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** One element: its name, its attributes (an undefined one left out), and what it holds. */
function element(
  name: string,
  attributes: Readonly<Record<string, string | number | undefined>>,
  children = "",
): string {
  const said = Object.entries(attributes)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`)
    .join("");
  return children === "" ? `<${name}${said}/>` : `<${name}${said}>${children}</${name}>`;
}

/** CSS declarations as one `style` attribute. */
function style(declarations: Readonly<Record<string, string | undefined>>): string {
  return Object.entries(declarations)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
}

// GAP [[01M54QTGRJYJZ7W5SXDP4356QW]] the export carries the default design system's tokens, not the one core's setting chooses
/** Every token the painting says, with its default-system value, as the SVG's own rule. */
function tokenRule(): string {
  const colours = [
    ...Object.values(TONE_TOKENS),
    ...CANVAS_PALETTE.map(({ id }) => paletteToken(id)),
  ].map((token) => `${token}: ${COLOR_TOKEN_FALLBACKS[token]};`);
  const steps = Object.values(TYPE_STEPS).map((step) => `${step}: ${TYPE_STEP_FALLBACKS[step]}px;`);
  const faces = CANVAS_FONTS.map((font) => `${FONT_FACES[font]}: ${FONT_FALLBACKS[font]};`);
  return `svg { ${[...colours, ...steps, `${CARD_BODY_STEP}: ${CARD_BODY_FALLBACK}px;`, ...faces].join(" ")} }`;
}

/** `text` broken into the lines a box `width` wide holds at `size`, its own breaks kept. */
function linesOf(text: string, width: number, size: number): string[] {
  const fits = Math.max(1, Math.floor(width / (size * CHARACTER_WIDTH)));
  return text.split("\n").flatMap((paragraph) => {
    const lines: string[] = [];
    let line = "";
    for (const word of paragraph.split(/\s+/).filter((w) => w !== "")) {
      if (line === "") line = word;
      else if (line.length + 1 + word.length <= fits) line = `${line} ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
    return lines;
  });
}

/** How a block of words is set: aligned and placed, in a face and step, at a size, in an ink. */
interface WordsSet extends Pick<WordsPaint, "align" | "valign"> {
  readonly face: string;
  readonly step: string;
  /** The step's size, px, which lines are broken and spaced by. */
  readonly size: number;
  readonly ink: Tone;
}

/** `text` set in a box `w` × `h` as `set` says. */
function wordsElement(
  text: string,
  box: { readonly w: number; readonly h: number },
  set: WordsSet,
): string {
  const { w, h } = box;
  const lines = linesOf(text, w - 2 * WORDS_INSET.x, set.size);
  const leading = set.size * LEADING;
  const x = { start: WORDS_INSET.x, middle: w / 2, end: w - WORDS_INSET.x }[set.align];
  const y = { top: WORDS_INSET.y, middle: h / 2, bottom: h - WORDS_INSET.y }[set.valign];
  // The block's first line, raised so the block, not its first line, sits where the anchor is.
  const raise = {
    top: 0,
    middle: ((lines.length - 1) / 2) * leading,
    bottom: (lines.length - 1) * leading,
  }[set.valign];
  const spans = lines
    .map((line, i) =>
      element(
        "tspan",
        { x: round(x), dy: round(i === 0 ? -raise : leading) },
        line === "" ? " " : escapeXml(line),
      ),
    )
    .join("");
  return element(
    "text",
    {
      "data-words": "",
      x: round(x),
      y: round(y),
      "text-anchor": ANCHORS[set.align],
      "dominant-baseline": BASELINES[set.valign],
      style: style({
        "font-family": `var(${set.face})`,
        "font-size": `var(${set.step})`,
        fill: toneCss(set.ink),
      }),
    },
    spans,
  );
}

/** What an item says in its own words: a text's text, a shape's or a frame's label. */
function ownWords(item: CanvasNode): string {
  if (isTextNode(item)) return item.text;
  if (isShapeNode(item) || isGroupNode(item)) return item.label ?? "";
  return "";
}

/** An item's chrome: its outline filled and stroked in its tones, and the marks it wears (`itemMarks`). */
function chromeElements(item: CanvasNode, paint: ItemPaint): string {
  const { chrome } = paint;
  if (chrome === null) return "";
  const d = svgPathData(
    itemOutline(item, item.width, item.height, cornerRadius(item, CORNER_RADII_FALLBACKS)),
  );
  const { outline } = chrome;
  const width = outline?.width ?? 0;
  const ink = toneCss(chrome.stroke);
  const path = element("path", {
    "data-outline-path": "",
    d,
    style: style({
      fill: chrome.ground === null ? "none" : toneCss(chrome.ground),
      stroke: outline === null ? "none" : ink,
    }),
    "stroke-width": width,
    "stroke-dasharray":
      outline === null || outline.pattern.length === 0 ? undefined : outline.pattern.join(" "),
  });
  const marks = itemMarks(item, item.width, item.height, paint).map((mark) =>
    element("path", {
      "data-item-mark": "",
      d: svgPathData(mark.path),
      style: style({ fill: mark.filled ? ink : "none", stroke: ink }),
      "stroke-width": mark.filled ? 0 : Math.max(width, 1),
    }),
  );
  return path + marks.join("");
}

/** Where an item's face is laid in the canvas: its box, turned about its centre as the top view turns it. */
function placement(item: CanvasNode): string {
  const face = topFace(item);
  if (face === null) return `translate(${round(item.x)} ${round(item.y)})`;
  const m = face.matrix;
  const [cx, cy] = [item.x + item.width / 2, item.y + item.height / 2];
  const turn = [m[0], m[3], m[1], m[4], face.lift.x, face.lift.y].map(round).join(" ");
  return `translate(${round(cx)} ${round(cy)}) matrix(${turn}) translate(${round(-item.width / 2)} ${round(-item.height / 2)})`;
}

/** One item, in its own box: its chrome, its picture, and its words. */
function itemElement(item: CanvasNode, source: SvgSource): string {
  const paint = itemPaint(item);
  const parts = [chromeElements(item, paint)];
  if (isFileNode(item) && isPictureFile(item.file)) {
    parts.push(
      element("image", {
        href: item.file,
        width: item.width,
        height: item.height,
        preserveAspectRatio: "xMidYMid slice",
      }),
    );
  }
  const box = { w: item.width, h: item.height };
  if (paint.words !== null) {
    const size = TYPE_STEP_FALLBACKS[paint.words.step];
    parts.push(wordsElement(ownWords(item), box, { ...paint.words, size, ink: paint.ink.words }));
  } else if (isKbNode(item)) {
    // A card's words are its node's, set as the outline sets them.
    parts.push(
      wordsElement(source.textOf(item.nodeId) ?? "", box, {
        align: "start",
        valign: "top",
        face: FONT_FACES.sans,
        step: CARD_BODY_STEP,
        size: CARD_BODY_FALLBACK,
        ink: paint.ink.words,
      }),
    );
  }
  return element(
    "g",
    {
      "data-card-id": item.id,
      transform: placement(item),
      opacity: paint.opacity === 1 ? undefined : paint.opacity,
    },
    parts.join(""),
  );
}

/** One edge: its route stroked as its look says, the heads its ends wear, and its label halfway. */
function edgeElement(edge: CanvasEdge, byId: ReadonlyMap<string, CanvasNode>, source: SvgSource) {
  const from = byId.get(edge.fromNode);
  const to = byId.get(edge.toNode);
  if (from === undefined || to === undefined) return "";
  const route = edgeRoute(from, to, edge);
  const paint = edgePaint(edge, { selected: false, unbound: !source.bound(edge) });
  const ink = toneCss(paint.ink);
  const line = element("path", {
    "data-edge-path": "",
    d: svgPathData(route.path),
    style: style({ fill: "none", stroke: paint.line === null ? "none" : ink }),
    "stroke-width": paint.width,
    "stroke-dasharray":
      paint.line === null || paint.line.pattern.length === 0
        ? undefined
        : paint.line.pattern.join(" "),
    "stroke-linecap": "round",
  });
  const heads = (["from", "to"] as const).map((end) => {
    const head = edgeHead(edge, route, end, paint.headLength);
    if (head === null) return "";
    return element("path", {
      "data-edge-head": end,
      "data-head-kind": head.kind,
      d: svgPathData(head.path),
      style: style({ fill: head.filled ? ink : "none", stroke: ink }),
      "stroke-width": head.filled ? 0 : paint.width,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
  });
  const label =
    edge.label === undefined || edge.label.trim() === ""
      ? ""
      : (() => {
          const at = routeMidpoint(route);
          return element(
            "text",
            {
              "data-edge-label": "",
              x: round(at.x),
              y: round(at.y),
              "text-anchor": "middle",
              "dominant-baseline": "central",
              style: style({
                "font-family": `var(${FONT_FACES.sans})`,
                "font-size": `var(${TYPE_STEPS.s})`,
                fill: toneCss({ of: "ink", amount: 0.7 }),
                stroke: toneCss({ of: "ground", amount: 1 }),
                "stroke-width": "4",
                "paint-order": "stroke",
              }),
            },
            escapeXml(edge.label),
          );
        })();
  return element(
    "g",
    { "data-edge-id": edge.id, opacity: paint.opacity === 1 ? undefined : paint.opacity },
    line + heads.join("") + label,
  );
}

/** The canvas extent the drawing covers: every item's turned box and every edge's route. */
function extentOf(doc: CanvasDoc, byId: ReadonlyMap<string, CanvasNode>) {
  const bounds = boxBounds(doc.nodes);
  const xs = bounds === null ? [] : [bounds.min.x, bounds.max.x];
  const ys = bounds === null ? [] : [bounds.min.y, bounds.max.y];
  for (const edge of doc.edges) {
    const [from, to] = [byId.get(edge.fromNode), byId.get(edge.toNode)];
    if (from === undefined || to === undefined) continue;
    for (const p of routePoints(edgeRoute(from, to, edge))) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  if (xs.length === 0) return { x: 0, y: 0, width: 2 * MARGIN, height: 2 * MARGIN };
  const [x, y] = [Math.min(...xs) - MARGIN, Math.min(...ys) - MARGIN];
  return { x, y, width: Math.max(...xs) + MARGIN - x, height: Math.max(...ys) + MARGIN - y };
}

/**
 * `doc` as one standalone SVG document: its ground, its edges under its
 * items, and its items back to front (`paintOrder`), each element marked with
 * the id of what it draws (`data-card-id`, `data-edge-id`).
 */
export function canvasSvg(doc: CanvasDoc, source: SvgSource): string {
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const extent = extentOf(doc, byId);
  const [x, y, width, height] = [extent.x, extent.y, extent.width, extent.height].map(round);
  const ground = element("rect", {
    x,
    y,
    width,
    height,
    style: style({ fill: `var(${TONE_TOKENS.ground})` }),
  });
  const edges = doc.edges.map((edge) => edgeElement(edge, byId, source)).join("");
  const items = paintOrder(doc.nodes)
    .map((item) => itemElement(item, source))
    .join("");
  return element(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: `${x} ${y} ${width} ${height}`,
      width,
      height,
    },
    `<style>${tokenRule()}</style>${ground}${edges}${items}`,
  );
}
