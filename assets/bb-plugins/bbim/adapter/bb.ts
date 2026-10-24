// What bbim needs to know about bb: where typing, terminals, browser tabs and
// dialogs live in its DOM, how it opens URLs, where the composer is, and its
// theme tokens. The core knows none of this.
import {
  type Action,
  type Bbim,
  type BbimHooks,
  createBbim,
  deepActiveElement,
  type FocusGuard,
  focusState,
  MENU_SELECTOR,
  MODAL_SELECTOR,
  type PageView,
  presenceGuard,
  type SettingsInput,
  type Theme,
  withinGuard,
} from "@popemkt/bbim-core";
import { pageRequest } from "@popemkt/bbim-core/page";
import type { HostSettings } from "./settings.ts";

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
    // A terminal is typing: the chords work there unless `chordsInTerminal`
    // is off (then alt+f is the shell's again); bare keys never do.
    withinGuard(TERMINAL, () => (live.chordsInTerminal ? "typing" : "blocked")),
    // The Browser chrome (address bar, toolbar) is typing: the chords work and
    // reach into the page (attachBrowserPage); bare keys stay off.
    withinGuard(BROWSER, "typing"),
    // bb's own `modalOpen` gate, the same selector.
    presenceGuard(doc, MODAL_SELECTOR, "blocked"),
    presenceGuard(doc, MENU_SELECTOR, "typing"),
  ];
}

/** What React supplies (app.tsx): the latest settings and bb's URL opener. */
const live: {
  settings: SettingsInput | undefined;
  /** Whether the bb command chords work while a terminal has focus (adapter-only setting). */
  chordsInTerminal: boolean;
  openUrl: ((url: string) => boolean) | undefined;
} = { settings: undefined, chordsInTerminal: true, openUrl: undefined };
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
    help: () => [
      {
        title: "bb commands (Settings → Keyboard)",
        rows: [
          { label: "Show hints (works while typing)", keys: ["⌥F by default"] },
          { label: "Show hints, links in a new tab", keys: ["⌥⇧F by default"] },
          { label: "Pick the pane j/k scroll", keys: ["⌥S by default"] },
        ],
      },
    ],
  };
}

let engineWindow: Window | undefined;

/** Mount bbim in this bb window until `signal` aborts (the content script's lifetime). */
export function mountBbim(signal: AbortSignal, win: Window = window): void {
  const doc = win.document;
  engineGuards = guards(doc);
  // A remount (a content-script reload) must not leave the old engine's keys live.
  engine?.dispose();
  const mounted = createBbim({
    window: win,
    signal,
    theme: BB_THEME,
    settings: live.settings ?? {},
    hooks: hooks(doc),
    // gi labels every input; the first label (and Enter) is the last one used,
    // else the composer in the pane you are in.
    preferInput: COMPOSER,
    hostChords: HOST_CHORDS,
  });
  engine = mounted;
  engineWindow = win;
  // Browser tabs that mounted before this engine join it now.
  for (const [view, attached] of browserPages) {
    attached.detach();
    browserPages.set(view, { detach: mounted.attachPage(view) });
  }
  signal.addEventListener(
    "abort",
    () => {
      if (engine !== mounted) return;
      engine = undefined;
      engineWindow = undefined;
    },
    { once: true },
  );
}

/**
 * The bb command chords at their default shortcuts (app.tsx). A Browser
 * page keeps the keys typed in it, so the page passes these back. A chord
 * rebound in bb's Keyboard settings is not seen here: the default still
 * works inside a page, the new one only outside it.
 */
const HOST_CHORDS: ReadonlyArray<{ readonly keys: string; readonly action: Action }> = [
  { keys: "<A-f>", action: "hints" },
  { keys: "<A-F>", action: "hintsNewTab" },
  { keys: "<A-s>", action: "pickScroll" },
];

/** bb's `experimental_page`: script access to one Browser tab (desktop only). */
export interface BrowserPage {
  readonly evaluate: (expression: string, options?: { readonly world?: "isolated" | "main" }) => Promise<unknown>;
  readonly onMessage: (listener: (data: unknown) => void) => () => void;
}

/** Every attached Browser tab, so a remounted engine picks them up. */
const browserPages = new Map<PageView, { detach: () => void }>();

const NOTHING = () => {};

/**
 * Hint the Browser tab whose toolbar holds `anchor`: its page joins every
 * hint session (labels drawn inside it, picks activated there), and the
 * chords typed in it come back. bb lays the native page view over the last
 * child of `[data-app-browser]`, so that element is where the page is.
 * Returns the detach; a missing page (not desktop) or browser view is a no-op.
 */
export function attachBrowserPage(anchor: Element, page: BrowserPage | null): () => void {
  const viewport = anchor.closest(BROWSER)?.lastElementChild ?? null;
  if (page === null || viewport === null) return NOTHING;
  const view: PageView = {
    element: viewport,
    // The page bridge rides along with every request: a navigation drops whatever was installed.
    send: (message) => {
      page.evaluate(pageRequest(message), { world: "isolated" }).catch(NOTHING);
    },
    listen: (handler) => page.onMessage(handler),
  };
  browserPages.set(view, { detach: engine?.attachPage(view) ?? NOTHING });
  return () => {
    browserPages.get(view)?.detach();
    browserPages.delete(view);
  };
}

export function syncSettings(input: SettingsInput, host: HostSettings = { chordsInTerminal: true }): void {
  live.settings = input;
  live.chordsInTerminal = host.chordsInTerminal;
  engine?.setSettings(input);
}

export function syncOpenUrl(openUrl: (url: string) => boolean): void {
  live.openUrl = openUrl;
}

export function runAction(action: Action): void {
  engine?.run(action);
}

/**
 * Whether a bb command may run now. In a terminal with `chordsInTerminal`
 * off, or while a dialog is open, the chord is not bbim's (alt+f is
 * forward-word in a shell), so the command declines and bb lets the key
 * through. Focus inside a Browser page never reaches here: the page passes
 * the chords back itself (attachBrowserPage).
 */
export function commandAvailable(): boolean {
  return engine !== undefined && engineWindow !== undefined && focusState(engineGuards, deepActiveElement(engineWindow.document)) !== "blocked";
}
