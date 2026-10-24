// The overlay: one fixed, click-through layer in a shadow root, holding hint
// labels, activation flashes and the help panel. It never moves page layout
// and the page's CSS never reaches into it. Colors and type come from CSS
// custom properties (THEME_PROPERTIES) a host may set on `theme`. The labels
// themselves are the label layer (label-layer.ts), which a page bridge draws
// with too.
import { Effect } from "effect";
import type { Rect } from "../domain/targets.ts";
import {
  applyTheme,
  element,
  type HintView,
  LABEL_STYLE,
  labelLayer,
  layerHost,
  placeBox,
  type Theme,
} from "./label-layer.ts";
import { attach, timers } from "./resources.ts";

export { type HintView, type Theme, THEME_PROPERTIES, type ThemeProperty } from "./label-layer.ts";

const STYLE = `${LABEL_STYLE}
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
  const { host, layer } = layerHost(doc, STYLE);
  const help = element(doc, "div", "help");
  help.hidden = true;
  help.setAttribute("role", "dialog");
  help.setAttribute("aria-label", "Keyboard help");
  layer.append(help);
  // body is typed non-null but is null before parsing reaches it.
  yield* attach((doc.body as HTMLElement | null) ?? doc.documentElement, host);
  const schedule = win === null ? undefined : yield* timers(win);
  const labels = labelLayer(layer);
  const setTheme = (next: Theme) => applyTheme(host, next);
  setTheme(theme);

  const overlay: Overlay = {
    host,
    setTheme,
    showHints: labels.show,
    narrow: labels.narrow,
    reposition: labels.reposition,
    hideHints: labels.hide,
    flash: (rect) => {
      if (schedule === undefined) return;
      const node = element(doc, "div", "flash");
      placeBox(node, rect);
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
