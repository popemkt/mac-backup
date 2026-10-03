/**
 * What sandboxed code draws (DESIGN.md → Sandbox → Drawing). A guest has no
 * DOM: it describes what to show as a tree of plain data, and the host
 * builds it from an allowlist of HTML and SVG elements and attributes. No
 * element can run script, load anything or navigate, so the frame's CSP is a
 * second fence, not the only one.
 *
 * A drawing is text (a string or a number), nothing (`null`, a boolean), an
 * element `[tag, attrs?, ...children]` — attrs being a plain object — or an
 * array of drawings, which is their sequence.
 */
import { Predicate } from "effect";

/** A drawing the host built from what the guest sent: only what the allowlist keeps. */
export type SafeNode =
  | { readonly t: "text"; readonly text: string }
  | {
      readonly t: "element";
      readonly svg: boolean;
      readonly tag: string;
      readonly attrs: readonly (readonly [string, string])[];
      readonly children: readonly SafeNode[];
    };

const HTML_TAGS = new Set(
  (
    "div span p h1 h2 h3 h4 h5 h6 ul ol li dl dt dd table thead tbody tfoot tr th td caption " +
    "colgroup col strong em b i u s small sub sup mark code pre kbd samp var abbr cite q " +
    "blockquote br hr wbr section article header footer main nav aside figure figcaption " +
    "details summary button label input select option optgroup textarea progress meter output time"
  ).split(" "),
);

const SVG_TAGS = new Set(
  (
    "svg g path rect circle ellipse line polyline polygon text tspan title desc defs " +
    "linearGradient radialGradient stop clipPath mask pattern marker symbol"
  ).split(" "),
);

const GLOBAL_ATTRS = new Set(
  "id class title role tabindex hidden lang dir style width height".split(" "),
);

const HTML_ATTRS = new Set(
  (
    "value checked disabled placeholder min max step name for open selected multiple rows cols " +
    "maxlength readonly colspan rowspan scope type datetime"
  ).split(" "),
);

const SVG_ATTRS = new Set(
  (
    "viewBox d x y x1 y1 x2 y2 cx cy r rx ry points fill stroke stroke-width stroke-linecap " +
    "stroke-linejoin stroke-dasharray stroke-dashoffset opacity fill-opacity stroke-opacity " +
    "fill-rule clip-rule transform text-anchor dominant-baseline font-size font-weight " +
    "font-family font-style letter-spacing offset stop-color stop-opacity gradientUnits " +
    "gradientTransform preserveAspectRatio dx dy rotate textLength marker-start marker-mid " +
    "marker-end refX refY markerWidth markerHeight orient markerUnits patternUnits " +
    "patternTransform clip-path mask vector-effect pathLength fx fy spreadMethod"
  ).split(" "),
);

/** The SVG attributes that may name a paint server or a clip: only a local `url(#id)`. */
const SVG_REF_ATTRS = new Set(
  "fill stroke clip-path mask marker-start marker-mid marker-end".split(" "),
);

/** The input types that are controls and fetch nothing (no `image`, no `file`, no `submit`). */
const INPUT_TYPES = new Set("text number range checkbox radio color date button search".split(" "));

/** A style or attribute value that could reach outside: a URL, an escape, an import, a script. */
const REACHES_OUT = /url\s*\(|\\|@import|expression\s*\(|javascript:|-moz-binding|behavior\s*:/i;

const LOCAL_REF = /^\s*url\(\s*#[A-Za-z][\w.-]*\s*\)\s*$/;

/** How long one text run or attribute value may be. */
const MAX_TEXT = 20_000;
/** How deep a drawing may nest. */
const MAX_DEPTH = 64;

function attrKept(name: string, value: string, tag: string, svg: boolean): boolean {
  if (/^on/i.test(name)) return false;
  if (name === "style") return !REACHES_OUT.test(value);
  if (name.startsWith("aria-") || name.startsWith("data-")) {
    return /^[a-z][a-z0-9-]*$/.test(name) && !REACHES_OUT.test(value);
  }
  if (svg && SVG_REF_ATTRS.has(name) && /url\s*\(/i.test(value)) return LOCAL_REF.test(value);
  if (REACHES_OUT.test(value)) return false;
  if (GLOBAL_ATTRS.has(name)) return true;
  if (svg) return SVG_ATTRS.has(name);
  if (name === "type") {
    if (tag === "input") return INPUT_TYPES.has(value.toLowerCase());
    if (tag === "button") return value.toLowerCase() === "button";
    return false;
  }
  return HTML_ATTRS.has(name);
}

/** What a sanitized drawing dropped, to tell the guest's author. */
export interface DrawingReport {
  readonly nodes: readonly SafeNode[];
  /** One line per kind of thing dropped. */
  readonly dropped: readonly string[];
  /** Whether the drawing was cut short at `maxNodes`. */
  readonly truncated: boolean;
}

/** An attribute's value as text, or `null` when it sets nothing (absent, `false`, or not a scalar). */
function attrText(value: unknown): string | null {
  if (value === true) return "";
  if (typeof value === "string") return value.slice(0, MAX_TEXT);
  if (typeof value === "number") return String(value);
  return null;
}

/** The attributes an element keeps, each dropped one named in `dropped`. */
function keptAttrs(
  raw: Readonly<Record<string, unknown>>,
  tag: string,
  svg: boolean,
  dropped: Set<string>,
): (readonly [string, string])[] {
  const attrs: (readonly [string, string])[] = [];
  for (const [rawName, rawValue] of Object.entries(raw)) {
    const text = attrText(rawValue);
    if (text === null) continue;
    const name = svg ? rawName : rawName.toLowerCase();
    if (/^[A-Za-z][A-Za-z0-9_:-]*$/.test(name) && attrKept(name, text, tag, svg)) {
      attrs.push([name, text]);
    } else {
      dropped.add(`attribute ${rawName}`);
    }
  }
  return attrs;
}

/** Whether `tag` may be drawn, inside an SVG or not. */
function tagAllowed(tag: string, svg: boolean): boolean {
  return svg ? SVG_TAGS.has(tag) : HTML_TAGS.has(tag.toLowerCase());
}

/**
 * The drawing `input` as the host may build it: every element and
 * attribute outside the allowlist dropped (an element with its subtree), text
 * kept as text, cut short after `maxNodes` nodes. Never throws: whatever the
 * guest sent, the host gets something it can draw.
 */
export function sanitizeDrawing(input: unknown, maxNodes: number): DrawingReport {
  const dropped = new Set<string>();
  let count = 0;
  let truncated = false;

  const element = (
    items: readonly unknown[],
    tag: string,
    svg: boolean,
    depth: number,
  ): SafeNode[] => {
    const inSvg = svg || tag === "svg";
    if (!tagAllowed(tag, inSvg)) {
      dropped.add(`<${tag}>`);
      return [];
    }
    count += 1;
    const [, maybeAttrs, ...children] = items;
    const hasAttrs = Predicate.isObject(maybeAttrs) && !Array.isArray(maybeAttrs);
    const name = inSvg ? tag : tag.toLowerCase();
    const attrs = hasAttrs ? keptAttrs(maybeAttrs, name, inSvg, dropped) : [];
    const kids = (hasAttrs ? children : items.slice(1)).flatMap((child) =>
      visit(child, inSvg, depth + 1),
    );
    return [{ t: "element", svg: inSvg, tag: name, attrs, children: kids }];
  };

  const visit = (value: unknown, svg: boolean, depth: number): SafeNode[] => {
    if (count >= maxNodes) {
      truncated = true;
      return [];
    }
    if (value === null || value === undefined || typeof value === "boolean") return [];
    if (typeof value === "string" || typeof value === "number") {
      count += 1;
      return [{ t: "text", text: String(value).slice(0, MAX_TEXT) }];
    }
    if (!Array.isArray(value)) {
      dropped.add("a value that is neither text, an element nor a list");
      return [];
    }
    if (depth > MAX_DEPTH) {
      dropped.add(`anything nested deeper than ${String(MAX_DEPTH)}`);
      return [];
    }
    const items: readonly unknown[] = value;
    const [head] = items;
    // A list that does not start with a tag is a sequence of drawings.
    if (typeof head !== "string") return items.flatMap((item) => visit(item, svg, depth + 1));
    return element(items, head, svg, depth);
  };

  const nodes = visit(input, false, 0);
  return { nodes, dropped: [...dropped], truncated };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const VOID_TAGS = new Set(["br", "hr", "wbr", "input", "col"]);

/** A sanitized drawing as HTML text, every text run and value escaped. */
export function drawingToHtml(nodes: readonly SafeNode[]): string {
  return nodes
    .map((node) => {
      if (node.t === "text") return escapeHtml(node.text);
      const attrs = node.attrs.map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join("");
      const open =
        node.tag === "svg"
          ? `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>`
          : `<${node.tag}${attrs}>`;
      if (!node.svg && VOID_TAGS.has(node.tag)) return open;
      return `${open}${drawingToHtml(node.children)}</${node.tag}>`;
    })
    .join("");
}

/** The parts of a document {@link drawingToDom} builds with, so it needs no DOM types. */
export interface DrawingDocument<N> {
  createElement(tag: string): N & DrawingElement<N>;
  createElementNS(namespace: string, tag: string): N & DrawingElement<N>;
  createTextNode(text: string): N;
}

export interface DrawingElement<N> {
  setAttribute(name: string, value: string): void;
  appendChild(child: N): unknown;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** A sanitized drawing as DOM nodes of `doc`, built element by element: no HTML is parsed. */
export function drawingToDom<N>(doc: DrawingDocument<N>, nodes: readonly SafeNode[]): N[] {
  return nodes.map((node) => {
    if (node.t === "text") return doc.createTextNode(node.text);
    const element = node.svg ? doc.createElementNS(SVG_NS, node.tag) : doc.createElement(node.tag);
    for (const [name, value] of node.attrs) element.setAttribute(name, value);
    for (const child of drawingToDom(doc, node.children)) element.appendChild(child);
    return element;
  });
}
