// Hint labels drawn into a layer: the one piece of the overlay a page bridge
// needs too (a page shown in a native view covers the parent's overlay, so it
// draws its own labels). Plain DOM, no Effect: the page bridge bundles it.
import type { Rect } from "../domain/targets.ts";

/**
 * Every themable property and its default. The defaults are a dark pill with
 * a light ring, legible on light and dark pages alike.
 */
export const THEME_PROPERTIES = {
  "--bbim-hint-bg": "#16181d",
  "--bbim-hint-fg": "#ffffff",
  "--bbim-hint-typed": "rgba(255, 255, 255, 0.42)",
  "--bbim-hint-ring": "rgba(255, 255, 255, 0.55)",
  "--bbim-hint-shadow": "rgba(0, 0, 0, 0.35)",
  "--bbim-accent": "#f5b301",
  "--bbim-font": 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
  "--bbim-panel-bg": "#16181d",
  "--bbim-panel-fg": "#f2f3f5",
  "--bbim-panel-muted": "rgba(242, 243, 245, 0.62)",
  "--bbim-panel-border": "rgba(255, 255, 255, 0.14)",
  "--bbim-key-bg": "rgba(255, 255, 255, 0.1)",
} as const;

export type ThemeProperty = keyof typeof THEME_PROPERTIES;
export type Theme = Readonly<Partial<Record<ThemeProperty, string>>>;

/** The layer and label styles. */
export const LABEL_STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
.hint {
  position: absolute; left: 0; top: 0;
  font: 650 11px/1 var(--bbim-font);
  letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap;
  padding: 2px 4px 2px 4.5px; border-radius: 4px;
  color: var(--bbim-hint-fg); background: var(--bbim-hint-bg);
  box-shadow: 0 0 0 1px var(--bbim-hint-ring), 0 1px 3px var(--bbim-hint-shadow);
}
/* Faded: the control shows only on hover. Same pill, dimmed, with a dashed ring. */
.hint.faded {
  color: color-mix(in srgb, var(--bbim-hint-fg) 72%, transparent);
  background: color-mix(in srgb, var(--bbim-hint-bg) 62%, transparent);
  box-shadow: 0 1px 3px var(--bbim-hint-shadow);
  outline: 1px dashed var(--bbim-hint-ring); outline-offset: 0;
}
.hint[hidden] { display: none; }
/* A pane a picker offers: a subtle outline around it, its label inside the corner. */
.surface {
  position: absolute; left: 0; top: 0; box-sizing: border-box; border-radius: 6px;
  border: 2px solid color-mix(in srgb, var(--bbim-accent) 60%, transparent);
  background: color-mix(in srgb, var(--bbim-accent) 5%, transparent);
}
.surface[hidden] { display: none; }
.hint .typed { color: var(--bbim-hint-typed); }
`;

export interface HintView {
  readonly label: string;
  readonly rect: Rect;
  /** The target is drawn only on hover: its label is de-emphasized. */
  readonly faded?: boolean;
  /** The target is a surface (a pane): outline it and put the label inside its top-left corner. */
  readonly outline?: boolean;
  /** Someone else draws this label (a page under a native view): keep its place, show nothing. */
  readonly elsewhere?: boolean;
}

export interface LabelLayer {
  readonly show: (views: ReadonlyArray<HintView>) => void;
  /** Narrow to labels starting with `typed`, highlighting the typed part. */
  readonly narrow: (typed: string) => void;
  /** Move labels to new boxes (after a scroll); undefined hides that label. */
  readonly reposition: (rects: ReadonlyArray<Rect | undefined>) => void;
  readonly hide: () => void;
}

/** Approximate label size, used to keep labels inside the viewport. */
const LABEL_HEIGHT = 15;
const CHAR_WIDTH = 8;

const labelWidth = (label: string) => label.length * CHAR_WIDTH + 9;

/** Where a label goes: over the top-left corner of a control, inside the corner of a surface. */
function labelPosition(rect: Rect, label: string, win: Window, inside: boolean): { x: number; y: number } {
  const width = labelWidth(label);
  const inset = inside ? 6 : -2;
  const x = Math.min(Math.max(0, rect.left + inset), Math.max(0, win.innerWidth - width));
  const y = Math.min(Math.max(0, rect.top + inset), Math.max(0, win.innerHeight - LABEL_HEIGHT));
  return { x: Math.round(x), y: Math.round(y) };
}

/** How much of a label another may cover before it moves aside: more and the one beneath is unreadable. */
const CROWDED = 1 / 3;
/** Most moves a label makes looking for room; past that it stays where the last move put it. */
const MAX_MOVES = 6;

interface LabelBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

function covered(a: LabelBox, b: LabelBox): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y, b.y) + LABEL_HEIGHT - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Every label's place, in order. A label that would sit mostly on top of an
 * earlier one (a hover-only × drawn over its tab's corner) moves right of it,
 * or below it at the viewport's edge, so both stay readable. Earlier labels
 * keep their place: they are the shorter, visible targets'. `undefined` (no
 * box, or drawn elsewhere) takes no room.
 */
function placeLabels(
  entries: ReadonlyArray<{ readonly rect: Rect; readonly label: string; readonly inside: boolean } | undefined>,
  win: Window,
): ReadonlyArray<{ x: number; y: number } | undefined> {
  const placed: Array<LabelBox> = [];
  return entries.map((entry) => {
    if (entry === undefined) return undefined;
    const start = labelPosition(entry.rect, entry.label, win, entry.inside);
    let box: LabelBox = { ...start, width: labelWidth(entry.label) };
    for (let moves = 0; moves < MAX_MOVES; moves += 1) {
      const current = box;
      // Measured against the smaller label: a short label half under a long one is unreadable.
      const under = placed.find((other) => covered(current, other) > CROWDED * Math.min(current.width, other.width) * LABEL_HEIGHT);
      if (under === undefined) break;
      const right = under.x + under.width + 1;
      box =
        right + box.width <= win.innerWidth
          ? { ...box, x: right }
          : { ...box, y: Math.min(under.y + LABEL_HEIGHT + 1, Math.max(0, win.innerHeight - LABEL_HEIGHT)) };
    }
    placed.push(box);
    return { x: box.x, y: box.y };
  });
}

export function placeBox(node: HTMLElement, rect: Rect): void {
  node.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
}

export function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string) {
  const node = doc.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Labels drawn into `layer` (a `.layer` inside a shadow root styled with LABEL_STYLE). */
export function labelLayer(layer: HTMLElement): LabelLayer {
  const doc = layer.ownerDocument;
  const win = doc.defaultView;
  let labels: Array<{ node: HTMLElement; label: string; surface: HTMLElement | undefined; elsewhere: boolean }> = [];
  const hide = () => {
    for (const { node, surface } of labels) {
      node.remove();
      surface?.remove();
    }
    labels = [];
  };
  return {
    show: (views) => {
      hide();
      const places =
        win === null
          ? []
          : placeLabels(
              views.map(({ label, rect, outline = false, elsewhere = false }) => (elsewhere ? undefined : { rect, label, inside: outline })),
              win,
            );
      labels = views.map(({ label, rect, faded = false, outline = false, elsewhere = false }, index) => {
        const surface = outline ? element(doc, "div", "surface") : undefined;
        if (surface !== undefined) {
          placeBox(surface, rect);
          layer.append(surface);
        }
        const node = element(doc, "div", faded ? "hint faded" : "hint");
        node.append(element(doc, "span", "typed"), element(doc, "span", undefined, label));
        const place = places[index];
        if (place !== undefined) node.style.transform = `translate(${place.x}px, ${place.y}px)`;
        if (elsewhere) {
          node.style.visibility = "hidden";
          if (surface !== undefined) surface.style.visibility = "hidden";
        }
        layer.append(node);
        return { node, label, surface, elsewhere };
      });
    },
    narrow: (typed) => {
      for (const { node, label, surface } of labels) {
        const matches = label.startsWith(typed);
        node.hidden = !matches;
        if (surface !== undefined) surface.hidden = !matches;
        if (!matches) continue;
        const [done, rest] = [node.firstChild, node.lastChild];
        if (done !== null) done.textContent = typed;
        if (rest !== null) rest.textContent = label.slice(typed.length);
      }
    },
    reposition: (rects) => {
      const places =
        win === null
          ? []
          : placeLabels(
              labels.map(({ label, surface, elsewhere }, index) => {
                const rect = rects[index];
                return rect === undefined || elsewhere ? undefined : { rect, label, inside: surface !== undefined };
              }),
              win,
            );
      labels.forEach(({ node, surface }, index) => {
        const rect = rects[index];
        const place = places[index];
        if (rect === undefined || place === undefined) {
          node.style.visibility = "hidden";
          if (surface !== undefined) surface.style.visibility = "hidden";
          return;
        }
        const { x, y } = place;
        node.style.visibility = "";
        node.style.transform = `translate(${x}px, ${y}px)`;
        if (surface !== undefined) placeBox(surface, rect);
      });
    },
    hide,
  };
}

/** A fixed, click-through host with a shadow root holding a `.layer`; `style` is prepended. */
export function layerHost(doc: Document, style: string): { readonly host: HTMLElement; readonly layer: HTMLElement } {
  const host = doc.createElement("div");
  host.setAttribute("data-bbim-overlay", "");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict;";
  const root = host.attachShadow({ mode: "open" });
  const layer = element(doc, "div", "layer");
  root.append(element(doc, "style", undefined, style), layer);
  return { host, layer };
}

/** Set every theme property on `host`, falling back to the defaults. */
export function applyTheme(host: HTMLElement, theme: Theme): void {
  for (const [property, fallback] of Object.entries(THEME_PROPERTIES)) {
    host.style.setProperty(property, theme[property as ThemeProperty] ?? fallback);
  }
}
