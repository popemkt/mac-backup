// What bbim needs to know about bb: where typing, terminals, browser tabs and
// dialogs live in its DOM, how it opens URLs, where the composer is, and its
// theme tokens. The core knows none of this.
import {
  type Action,
  type Bbim,
  type BbimHooks,
  createBbim,
  deepActiveElement,
  focusForTyping,
  type FocusGuard,
  focusState,
  isRendered,
  MENU_SELECTOR,
  MODAL_SELECTOR,
  presenceGuard,
  type SettingsInput,
  type Theme,
  withinGuard,
} from "@popemkt/bbim-core";

/** bb's tokens (its Tailwind theme variables), so hints follow light, dark and custom palettes. */
export const BB_THEME: Theme = {
  "--bbim-hint-bg": "var(--foreground, #16181d)",
  "--bbim-hint-fg": "var(--background, #ffffff)",
  "--bbim-hint-typed": "color-mix(in oklab, var(--background, #fff) 45%, var(--foreground, #000))",
  "--bbim-hint-ring": "color-mix(in oklab, var(--background, #fff) 70%, transparent)",
  "--bbim-accent": "var(--attention, #f5b301)",
  "--bbim-panel-bg": "var(--popover, #16181d)",
  "--bbim-panel-fg": "var(--popover-foreground, #f2f3f5)",
  "--bbim-panel-muted": "var(--muted-foreground, rgba(242, 243, 245, 0.62))",
  "--bbim-panel-border": "var(--border, rgba(255, 255, 255, 0.14))",
  "--bbim-key-bg": "var(--muted, rgba(255, 255, 255, 0.1))",
};

/** bb marks its terminal and Browser views with these attributes (its own keybinding gates read them). */
const TERMINAL = "[data-app-terminal]";
const BROWSER = "[data-app-browser]";
const COMPOSER = '.chat-prompt-box [contenteditable]:not([contenteditable="false"]), .chat-prompt-box textarea';

function guards(doc: Document): ReadonlyArray<FocusGuard> {
  return [
    withinGuard(TERMINAL),
    // GAP [[01M5KBVSMZ39HBDVBG4CA5TEH0]] a browser tab's page gets no hints:
    // bbim stands aside there until it injects into the tab (experimental_page).
    withinGuard(BROWSER),
    // bb's own `modalOpen` gate, the same selector.
    presenceGuard(doc, MODAL_SELECTOR, "blocked"),
    presenceGuard(doc, MENU_SELECTOR, "typing"),
  ];
}

function isShown(element: Element): boolean {
  return element.getClientRects().length > 0 && isRendered(element);
}

/** The composer of the pane the person is in: the nearest one to focus, else the first shown. */
function focusComposer(doc: Document): boolean {
  const composers = [...doc.querySelectorAll(COMPOSER)].filter(isShown);
  if (composers.length === 0) return false;
  let chosen = composers[0];
  for (let scope = deepActiveElement(doc); scope !== null; scope = scope.parentElement) {
    const within = scope;
    const inside = composers.find((composer) => within.contains(composer));
    if (inside !== undefined) {
      chosen = inside;
      break;
    }
  }
  if (chosen === undefined) return false;
  focusForTyping(chosen);
  return true;
}

/** What React supplies (app.tsx): the latest settings and bb's URL opener. */
const live: {
  settings: SettingsInput | undefined;
  openUrl: ((url: string) => boolean) | undefined;
} = { settings: undefined, openUrl: undefined };
let engine: Bbim | undefined;
let engineGuards: ReadonlyArray<FocusGuard> = [];

function hooks(doc: Document): BbimHooks {
  return {
    guards: engineGuards,
    // An in-app link opens through its own click handler (a mod-click for a
    // new tab); only another origin goes to bb's URL opener.
    openUrl: (url) => {
      const target = new URL(url, doc.baseURI);
      if (target.origin === doc.defaultView?.location.origin) return false;
      return live.openUrl?.(target.href) ?? false;
    },
    focusInput: () => focusComposer(doc),
    help: () => [
      {
        title: "bb commands (Settings → Keyboard)",
        rows: [
          { label: "Show hints (works while typing)", keys: ["⌥F by default"] },
          { label: "Show hints, links in a new tab", keys: ["⌥⇧F by default"] },
        ],
      },
    ],
  };
}

/** Mount bbim in this bb window until `signal` aborts (the content script's lifetime). */
export function mountBbim(signal: AbortSignal): void {
  const doc = window.document;
  engineGuards = guards(doc);
  const mounted = createBbim({ window, signal, theme: BB_THEME, settings: live.settings ?? {}, hooks: hooks(doc) });
  engine = mounted;
  signal.addEventListener(
    "abort",
    () => {
      if (engine === mounted) engine = undefined;
    },
    { once: true },
  );
}

export function syncSettings(input: SettingsInput): void {
  live.settings = input;
  engine?.setSettings(input);
}

export function syncOpenUrl(openUrl: (url: string) => boolean): void {
  live.openUrl = openUrl;
}

export function runAction(action: Action): void {
  engine?.run(action);
}

/**
 * Whether a bb command may run now. Inside a terminal or a Browser tab the
 * chord stays theirs (alt+f is forward-word in a shell), so the command
 * declines and bb lets the key through.
 */
export function commandAvailable(): boolean {
  return engine !== undefined && focusState(engineGuards, deepActiveElement(window.document)) !== "blocked";
}
