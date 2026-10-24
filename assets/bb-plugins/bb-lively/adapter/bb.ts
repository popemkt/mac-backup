// What lively needs to know about bb: its selectors (selectors.ts), how a
// sidebar indicator change maps to a pulse, and how the content script, the
// composer slot and the app overlay hand their signals to one engine. The
// core knows none of this.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import {
  type Canary,
  type CanaryReading,
  createCanary,
  createLively,
  type Lively,
  type SettingsInput,
  type StatusTone,
} from "@popemkt/bb-lively-core";
import { BB_TARGETS, type BbSelector, SELECTOR_TABLE, SELECTORS, THREAD_ID_ATTRIBUTE } from "./selectors.ts";

type Indicator = PluginSidebarThread["indicator"];

/** The indicator changes worth a pulse: a turn ended, failed, or now waits for the person. */
const TONES: Partial<Record<Indicator, StatusTone>> = {
  "unread-success": "success",
  "unread-error": "error",
  "waiting-for-input": "waiting",
};

/**
 * The pulse for a thread whose indicator went from `before` to `after`, if
 * any. A thread seen for the first time (`before` undefined) never pulses:
 * that is the list loading, not something happening.
 */
export function toneFor(before: Indicator | undefined, after: Indicator): StatusTone | undefined {
  if (before === undefined || before === after) return undefined;
  return TONES[after];
}

/** What React supplies (app.tsx): the latest settings. */
const live: { settings: SettingsInput | undefined } = { settings: undefined };
let engine: { readonly lively: Lively; readonly canary: Canary<BbSelector>; readonly win: Window } | undefined;

/** Mount lively in this bb window until `signal` aborts (the content script's lifetime). */
export function mountLively(signal: AbortSignal, win: Window = window): void {
  // A remount (a content-script reload) must not leave the old layer behind.
  engine?.lively.dispose();
  engine?.canary.dispose();
  const mounted = {
    lively: createLively({ window: win, signal, targets: BB_TARGETS, settings: live.settings ?? {} }),
    canary: createCanary(win, SELECTOR_TABLE),
    win,
  };
  engine = mounted;
  signal.addEventListener(
    "abort",
    () => {
      mounted.canary.dispose();
      if (engine === mounted) engine = undefined;
    },
    { once: true },
  );
}

export function syncSettings(input: SettingsInput): void {
  live.settings = input;
  engine?.lively.setSettings(input);
}

/** A composer reported a successful local send (`useComposer().onSubmitted`). */
export function sent(): void {
  engine?.lively.sent();
}

/** Diff the sidebar's indicators against the last ones seen; pulse each row that changed into a tone. */
export function threadsChanged(
  previous: ReadonlyMap<string, Indicator>,
  threads: ReadonlyArray<Pick<PluginSidebarThread, "id" | "indicator">>,
): Map<string, Indicator> {
  const next = new Map<string, Indicator>();
  for (const thread of threads) {
    next.set(thread.id, thread.indicator);
    const tone = toneFor(previous.get(thread.id), thread.indicator);
    if (tone !== undefined) pulseThread(thread.id, tone);
  }
  return next;
}

function pulseThread(threadId: string, tone: StatusTone): boolean {
  if (engine === undefined) return false;
  const doc = engine.win.document;
  const link = doc.querySelector(`[${THREAD_ID_ATTRIBUTE}="${(engine.win as Window & typeof globalThis).CSS.escape(threadId)}"]`);
  const row = link?.closest(SELECTORS.statusRow.selector);
  // A row scrolled out of the sidebar or in a collapsed section has nothing to ring.
  return row !== null && row !== undefined && engine.lively.pulseStatus(row, tone);
}

/** The selector canary for the settings page; undefined until the content script mounts. */
export function selectorHealth(): ReadonlyArray<CanaryReading<BbSelector>> | undefined {
  return engine?.canary.read();
}
