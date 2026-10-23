// The overlay: one fixed, click-through layer in a shadow root, holding hint
// labels, activation flashes and the help panel. It never moves page layout
// and the page's CSS never reaches into it. Colors and type come from CSS
// custom properties (THEME_PROPERTIES) a host may set on `theme`.
import { Effect } from "effect";
import type { Rect } from "../domain/targets.ts";
import { attach, timers } from "./resources.ts";

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

const STYLE = `
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
.hint .typed { color: var(--bbim-hint-typed); }
.flash {
  position: absolute; border-radius: 4px;
  box-shadow: 0 0 0 2px var(--bbim-accent), 0 0 0 6px color-mix(in srgb, var(--bbim-accent) 30%, transparent);
  background: color-mix(in srgb, var(--bbim-accent) 16%, transparent);
  animation: bbim-flash 380ms ease-out forwards;
}
@keyframes bbim-flash { 0% { opacity: 1; } 100% { opacity: 0; } }
.help {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  max-width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow: auto;
  box-sizing: border-box; padding: 18px 20px; border-radius: 12px;
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--bbim-panel-fg); background: var(--bbim-panel-bg);
  border: 1px solid var(--bbim-panel-border);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
  animation: bbim-in 120ms ease-out;
}
.help[hidden] { display: none; }
@keyframes bbim-in { from { opacity: 0; transform: translate(-50%, calc(-50% + 4px)); } }
.help h2 { margin: 0 0 10px; font-size: 14px; font-weight: 650; }
.help h3 { margin: 14px 0 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--bbim-panel-muted); }
.help .row { display: flex; justify-content: space-between; gap: 24px; padding: 3px 0; }
.help .keys { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
.help kbd {
  font: 600 11.5px/1 var(--bbim-font); padding: 3px 6px; border-radius: 5px;
  background: var(--bbim-key-bg); border: 1px solid var(--bbim-panel-border);
}
.help .problem { color: var(--bbim-accent); }
.help .foot { margin-top: 14px; font-size: 12px; color: var(--bbim-panel-muted); }
@media (prefers-reduced-motion: reduce) { .flash, .help { animation-duration: 1ms; } }
`;

export interface HintView {
  readonly label: string;
  readonly rect: Rect;
  /** The target is drawn only on hover: its label is de-emphasized. */
  readonly faded?: boolean;
}

export interface HelpSection {
  readonly title: string;
  readonly rows: ReadonlyArray<{ readonly label: string; readonly keys: ReadonlyArray<string> }>;
}

export interface HelpModel {
  readonly title: string;
  readonly sections: ReadonlyArray<HelpSection>;
  readonly problems: ReadonlyArray<string>;
  readonly footer: string;
}

export interface Overlay {
  showHints(views: ReadonlyArray<HintView>): void;
  /** Narrow to labels starting with `typed`, highlighting the typed part. */
  narrow(typed: string): void;
  /** Move labels to new boxes (after a scroll); undefined hides that label. */
  reposition(rects: ReadonlyArray<Rect | undefined>): void;
  hideHints(): void;
  flash(rect: Rect): void;
  showHelp(model: HelpModel): void;
  hideHelp(): void;
  setTheme(theme: Theme): void;
  /** The overlay's host element, which hint collection must skip. */
  readonly host: HTMLElement;
}

/** Approximate label size, used to keep labels inside the viewport. */
const LABEL_HEIGHT = 15;
const CHAR_WIDTH = 8;

function labelPosition(rect: Rect, label: string, win: Window): { x: number; y: number } {
  const width = label.length * CHAR_WIDTH + 9;
  const x = Math.min(Math.max(0, rect.left - 2), Math.max(0, win.innerWidth - width));
  const y = Math.min(Math.max(0, rect.top - 2), Math.max(0, win.innerHeight - LABEL_HEIGHT));
  return { x: Math.round(x), y: Math.round(y) };
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string) {
  const node = doc.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderHelp(doc: Document, panel: HTMLElement, model: HelpModel): void {
  panel.replaceChildren(element(doc, "h2", undefined, model.title));
  for (const section of model.sections) {
    panel.append(element(doc, "h3", undefined, section.title));
    for (const row of section.rows) {
      const line = element(doc, "div", "row");
      const keys = element(doc, "span", "keys");
      for (const key of row.keys) keys.append(element(doc, "kbd", undefined, key));
      line.append(element(doc, "span", undefined, row.label), keys);
      panel.append(line);
    }
  }
  if (model.problems.length > 0) {
    panel.append(element(doc, "h3", undefined, "Settings problems"));
    for (const problem of model.problems) panel.append(element(doc, "div", "row problem", problem));
  }
  panel.append(element(doc, "div", "foot", model.footer));
}

/** Mount the overlay into `doc` for as long as the scope lives. */
export const mountOverlay = Effect.fn("mountOverlay")(function* (doc: Document, theme: Theme) {
  const win = doc.defaultView;
  const host = doc.createElement("div");
  host.setAttribute("data-bbim-overlay", "");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict;";
  const root = host.attachShadow({ mode: "open" });
  const style = element(doc, "style", undefined, STYLE);
  const layer = element(doc, "div", "layer");
  const help = element(doc, "div", "help");
  help.hidden = true;
  help.setAttribute("role", "dialog");
  help.setAttribute("aria-label", "Keyboard help");
  layer.append(help);
  root.append(style, layer);
  // body is typed non-null but is null before parsing reaches it.
  yield* attach((doc.body as HTMLElement | null) ?? doc.documentElement, host);
  const schedule = win === null ? undefined : yield* timers(win);

  let labels: Array<{ node: HTMLElement; label: string }> = [];

  const setTheme = (next: Theme) => {
    for (const [property, fallback] of Object.entries(THEME_PROPERTIES)) {
      host.style.setProperty(property, next[property as ThemeProperty] ?? fallback);
    }
  };
  setTheme(theme);

  const overlay: Overlay = {
    host,
    setTheme,
    showHints: (views) => {
      for (const { node } of labels) node.remove();
      labels = views.map(({ label, rect, faded = false }) => {
        const node = element(doc, "div", faded ? "hint faded" : "hint");
        node.append(element(doc, "span", "typed"), element(doc, "span", undefined, label));
        if (win !== null) {
          const { x, y } = labelPosition(rect, label, win);
          node.style.transform = `translate(${x}px, ${y}px)`;
        }
        layer.append(node);
        return { node, label };
      });
    },
    narrow: (typed) => {
      for (const { node, label } of labels) {
        const matches = label.startsWith(typed);
        node.hidden = !matches;
        if (!matches) continue;
        const [done, rest] = [node.firstChild, node.lastChild];
        if (done !== null) done.textContent = typed;
        if (rest !== null) rest.textContent = label.slice(typed.length);
      }
    },
    reposition: (rects) => {
      labels.forEach(({ node, label }, index) => {
        const rect = rects[index];
        if (rect === undefined || win === null) {
          node.style.visibility = "hidden";
          return;
        }
        const { x, y } = labelPosition(rect, label, win);
        node.style.visibility = "";
        node.style.transform = `translate(${x}px, ${y}px)`;
      });
    },
    hideHints: () => {
      for (const { node } of labels) node.remove();
      labels = [];
    },
    flash: (rect) => {
      if (schedule === undefined) return;
      const node = element(doc, "div", "flash");
      node.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
      layer.append(node);
      schedule(420, () => node.remove());
    },
    showHelp: (model) => {
      renderHelp(doc, help, model);
      help.hidden = false;
    },
    hideHelp: () => {
      help.hidden = true;
    },
  };
  return overlay;
});
