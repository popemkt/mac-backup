// createBbim: the key engine, hints, overlay, frames and scrolling composed
// over one window. Everything it acquires lives in one scope; `dispose`
// closes it. Keydown handling is plain synchronous code (the hot path); only
// acquiring and releasing go through Effect.
import { Effect, Result } from "effect";
import { ACTION_INFO, ACTIONS, type Action } from "../domain/actions.ts";
import {
  formatSequence,
  isChord,
  type KeyEventLike,
  parseSequence,
  stroke,
  strokeFromEvent,
} from "../domain/keys.ts";
import { generateLabels } from "../domain/labels.ts";
import {
  back,
  compileKeymap,
  EMPTY_STATE,
  feed,
  type Keymap,
  type MatchState,
  typed,
} from "../domain/matcher.ts";
import { current, INITIAL_STACK, leave, type Mode, type ModeStack, ownsKeyboard, push } from "../domain/modes.ts";
import {
  decodeSettings,
  DEFAULT_SETTINGS,
  keyBindings,
  type Settings,
  type SettingsInput,
  type SettingsProblem,
} from "../domain/settings.ts";
import { area, order, type Rect, type TargetKind } from "../domain/targets.ts";
import { type ActivateContext, activateElement } from "./activate.ts";
import {
  activateRemote,
  collectRemote,
  listenForwarded,
  type RemoteTarget,
  setRemoteMode,
} from "./bridge-client.ts";
import { collectTargets, DEFAULT_SELECTORS, viewportOf } from "./collect.ts";
import { deepActiveElement, editableGuard, type FocusGuard, focusState, isEditable } from "./focus.ts";
import { frameTree, liveFrame, liveRect, type OpaqueFrame } from "./frames.ts";
import { type HelpModel, type HelpSection, mountOverlay, type Overlay, type Theme } from "./overlay.ts";
import { focusInput, TEXT_INPUT_SELECTOR } from "./inputs.ts";
import { frameThrottle, listen, timers } from "./resources.ts";
import { openScope, type ScopeHandle } from "./runtime.ts";
import { scroll, scrollTarget } from "./scroll.ts";

export interface BbimHooks {
  /** Extra focus guards (a terminal, a webview, a modal). Editable focus is built in. */
  readonly guards?: ReadonlyArray<FocusGuard>;
  /** Open a URL your way (new-tab hints, bridge open requests); false falls back. */
  readonly openUrl?: (url: string, options: { readonly newTab: boolean }) => boolean;
  /** Extra sections for the help overlay, such as host-owned chords. */
  readonly help?: () => ReadonlyArray<HelpSection>;
}

export interface CreateBbimOptions {
  /** The window to drive. Defaults to the global one. */
  readonly window?: Window;
  readonly settings?: SettingsInput;
  readonly hooks?: BbimHooks;
  readonly theme?: Theme;
  /** Candidate selectors for hints; defaults to DEFAULT_SELECTORS. */
  readonly selectors?: ReadonlyArray<string>;
  /** The inputs `focusInput` (gi) picks among; defaults to every text input. */
  readonly inputSelector?: string;
  /** Aborting it disposes bbim. */
  readonly signal?: AbortSignal;
  /** How long to wait for frames speaking the hint bridge. */
  readonly bridgeTimeoutMs?: number;
}

export interface Bbim {
  /** Run an action as if its key was pressed. */
  run(action: Action): void;
  /** Replace settings, keys included; returns what was invalid (and fell back). */
  setSettings(input: SettingsInput): ReadonlyArray<SettingsProblem>;
  mode(): Mode;
  dispose(): void;
}

type Target =
  | { readonly source: "local"; readonly element: Element; readonly kind: TargetKind; readonly rect: Rect }
  | { readonly source: "remote"; readonly remote: RemoteTarget; readonly kind: TargetKind; readonly rect: Rect };

interface HintSession {
  readonly scope: ScopeHandle;
  readonly newTab: boolean;
  readonly requestId: string;
  readonly frames: ReadonlyArray<OpaqueFrame>;
  /** Labels and their targets once collected; undefined while frames answer. */
  assigned: ReadonlyArray<{ readonly label: string; readonly target: Target }> | undefined;
  keymap: Keymap<number> | undefined;
  state: MatchState;
  /** Keys typed before the labels showed up, replayed when they do. */
  readonly queued: Array<KeyEventLike>;
}

const HINT_KEYS_LIMIT = 16;

function swallow(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function composedTarget(event: Event): Element | null {
  const first = event.composedPath()[0];
  return first !== undefined && "tagName" in first ? (first as Element) : null;
}

/** The element whose box defines the focus region: a pane-sized ancestor of `start`. */
function regionOf(doc: Document, start: Element | null): Element | null {
  const view = viewportOf(doc);
  const viewArea = Math.max(1, area(view));
  for (let element = start; element !== null; element = element.parentElement) {
    if (element === doc.body || element === doc.documentElement) return null;
    const share = area(element.getBoundingClientRect()) / viewArea;
    if (share >= 0.15 && share < 0.92) return element;
  }
  return null;
}

function helpModel(settings: Settings, problems: ReadonlyArray<string>, extra: ReadonlyArray<HelpSection>): HelpModel {
  const rows = ACTIONS.flatMap((action) => {
    const key = settings.keys[action];
    if (key === "") return [];
    const parsed = parseSequence(key);
    const shown = Result.isSuccess(parsed) ? formatSequence(parsed.success) : key;
    return [{ label: ACTION_INFO[action].label, keys: [shown] }];
  });
  return {
    title: "bbim keys",
    sections: [
      { title: settings.bareKeys ? "Anywhere you are not typing" : "Keys (single keys are off)", rows },
      ...extra,
      {
        title: "While hints are shown",
        rows: [
          { label: "Pick a target", keys: ["its letters"] },
          { label: "Open a link in a new tab", keys: ["Shift + last letter"] },
          { label: "Take back a letter", keys: ["Backspace"] },
          { label: "Cancel", keys: ["Esc"] },
        ],
      },
    ],
    problems,
    footer: "Esc, ? or a click closes this.",
  };
}

export function createBbim(options: CreateBbimOptions = {}): Bbim {
  const win = options.window ?? window;
  const doc = win.document;
  const hooks = options.hooks ?? {};
  const guards: ReadonlyArray<FocusGuard> = [editableGuard, ...(hooks.guards ?? [])];
  const selectors = options.selectors ?? DEFAULT_SELECTORS;
  const inputSelector = options.inputSelector ?? TEXT_INPUT_SELECTOR;
  const bridgeTimeoutMs = options.bridgeTimeoutMs ?? 150;
  const root = openScope();

  let settings: Settings = DEFAULT_SETTINGS;
  let problems: ReadonlyArray<string> = [];
  let keymap: Keymap<Action> = compileKeymap(keyBindings(settings));
  let keyState: MatchState = EMPTY_STATE;
  let stack: ModeStack = INITIAL_STACK;
  let session: HintSession | undefined;
  let lastPointer: Element | null = null;
  let lastEditable: Element | null = null;
  let requests = 0;

  const overlay: Overlay = root.run(mountOverlay(doc, options.theme ?? {}));
  const schedule = root.run(timers(win));
  const now = () => win.performance.now();

  const applySettings = (input: SettingsInput): ReadonlyArray<SettingsProblem> => {
    const decoded = decodeSettings(input, settings);
    settings = decoded.settings;
    keymap = compileKeymap(keyBindings(settings), { timeoutMs: settings.sequenceTimeoutMs });
    keyState = EMPTY_STATE;
    problems = [
      ...decoded.problems.map((problem) => `${problem.field}: ${problem.message}`),
      ...keymap.conflicts.map(
        (conflict) =>
          `${conflict.dropped.action} (${formatSequence(conflict.dropped.sequence)}) is unreachable: it ${
            conflict.reason === "duplicate" ? "repeats" : "overlaps"
          } ${conflict.kept.action} (${formatSequence(conflict.kept.sequence)})`,
      ),
    ];
    return decoded.problems;
  };

  const regionRect = (): Rect | undefined => {
    const element = regionOf(doc, lastPointer ?? deepActiveElement(doc));
    if (element === null) return undefined;
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width, height: box.height };
  };

  // ---- hints -------------------------------------------------------------

  const endHints = () => {
    const ending = session;
    if (ending === undefined) return;
    session = undefined;
    stack = leave(stack, "hint");
    overlay.hideHints();
    ending.scope.close();
  };

  const activate = (target: Target, newTab: boolean, requestId: string) => {
    overlay.flash(target.rect);
    if (target.source === "remote") {
      activateRemote(target.remote, requestId, newTab);
      return;
    }
    if (!target.element.isConnected) return;
    lastPointer = target.element;
    const context: ActivateContext = { newTab, ...(hooks.openUrl === undefined ? {} : { openUrl: hooks.openUrl }) };
    activateElement(target.element, target.kind, context);
  };

  const hintKey = (event: KeyEventLike) => {
    const active = session;
    if (active === undefined) return;
    if (event.key === "Escape") {
      endHints();
      return;
    }
    if (active.keymap === undefined || active.assigned === undefined) {
      if (active.queued.length < HINT_KEYS_LIMIT) active.queued.push(event);
      return;
    }
    if (event.key === "Backspace") {
      active.state = back(active.state);
      overlay.narrow(typed(active.keymap, active.state));
      return;
    }
    const pressed = strokeFromEvent(event);
    if (pressed === undefined || isChord(pressed)) return;
    const [next, step] = feed(active.keymap, active.state, pressed, now());
    active.state = next;
    if (step.kind === "pending") overlay.narrow(typed(active.keymap, next));
    if (step.kind !== "match") return;
    const chosen = active.assigned[step.binding.action];
    const newTab = active.newTab || event.shiftKey;
    endHints();
    if (chosen !== undefined) activate(chosen.target, newTab, active.requestId);
  };

  const showLabels = (active: HintSession, targets: ReadonlyArray<Target>) => {
    if (session !== active) return;
    if (targets.length === 0) {
      endHints();
      return;
    }
    const ordered = order(
      targets.map((target) => target.rect),
      regionRect(),
    );
    const labels = generateLabels(ordered.length, settings.hintAlphabet);
    const assigned = labels.flatMap((label, rank) => {
      const target = targets[ordered[rank] ?? -1];
      return target === undefined ? [] : [{ label, target }];
    });
    active.assigned = assigned;
    active.keymap = compileKeymap(
      assigned.map(({ label }, index) => ({ sequence: [...label].map((char) => stroke(char)), action: index })),
      { foldCase: true, restartOnMiss: false, timeoutMs: Number.POSITIVE_INFINITY },
    );
    overlay.showHints(assigned.map(({ label, target }) => ({ label, rect: target.rect })));
    for (const queued of active.queued.splice(0)) hintKey(queued);
  };

  const reposition = () => {
    const active = session;
    if (active?.assigned === undefined) return;
    const frames = new Map<OpaqueFrame, OpaqueFrame | undefined>();
    overlay.reposition(
      active.assigned.map(({ target }) => {
        if (target.source === "local") return liveRect(doc, target.element);
        const before = target.remote.frame;
        if (!frames.has(before)) frames.set(before, liveFrame(doc, before));
        const after = frames.get(before);
        if (after === undefined) return undefined;
        return {
          left: target.rect.left + after.offsetX - before.offsetX,
          top: target.rect.top + after.offsetY - before.offsetY,
          width: target.rect.width,
          height: target.rect.height,
        };
      }),
    );
  };

  const startHints = (newTab: boolean) => {
    if (session !== undefined) {
      endHints();
      return;
    }
    stack = leave(stack, "help");
    overlay.hideHelp();
    const tree = frameTree(doc);
    const local: Array<Target> = tree.documents.flatMap((placement) =>
      collectTargets(placement, { selectors, exclude: (element) => element === overlay.host }).map(
        (target): Target => ({ source: "local", ...target }),
      ),
    );
    requests += 1;
    const active: HintSession = {
      scope: root.child(),
      newTab,
      requestId: `bbim-${requests}`,
      frames: tree.opaque,
      assigned: undefined,
      keymap: undefined,
      state: EMPTY_STATE,
      queued: [],
    };
    session = active;
    stack = push(stack, "hint");
    const onScroll = active.scope.run(frameThrottle(win, reposition));
    active.scope.run(
      Effect.gen(function* () {
        for (const placement of tree.documents) {
          const view = placement.doc.defaultView;
          if (view === null) continue;
          if (view !== win) {
            // Keys pressed while focus is inside a same-origin frame land there.
            yield* listen<KeyboardEvent>(view, "keydown", (event) => {
              swallow(event);
              hintKey(event);
            }, { capture: true });
          }
          yield* listen(view, "scroll", onScroll, { capture: true, passive: true });
        }
        yield* listen(win, "resize", endHints);
        yield* listen(doc, "visibilitychange", endHints);
        if (active.frames.length > 0) {
          setRemoteMode(active.frames, true);
          yield* Effect.addFinalizer(() => Effect.sync(() => setRemoteMode(active.frames, false)));
          yield* listenForwarded(active.frames, {
            onKey: hintKey,
            onOpen: (url) => {
              // The frame could not open it itself (sandboxed); without a host opener, a plain new tab.
              if (hooks.openUrl?.(url, { newTab: true }) !== true) win.open(url, "_blank", "noopener,noreferrer");
            },
          });
        }
      }),
    );
    if (active.frames.length === 0) {
      showLabels(active, local);
      return;
    }
    active.scope.fork(
      Effect.map(collectRemote(active.frames, active.requestId, bridgeTimeoutMs), (remote) =>
        showLabels(active, [
          ...local,
          ...remote.map((target): Target => ({ source: "remote", remote: target, kind: target.kind, rect: target.rect })),
        ]),
      ),
    );
  };

  // ---- help --------------------------------------------------------------

  const toggleHelp = () => {
    if (current(stack) === "help") {
      stack = leave(stack, "help");
      overlay.hideHelp();
      return;
    }
    stack = push(stack, "help");
    overlay.showHelp(helpModel(settings, problems, hooks.help?.() ?? []));
  };

  // ---- actions -----------------------------------------------------------

  const run = (action: Action, repeat = false) => {
    switch (action) {
      case "scrollDown":
      case "scrollUp":
      case "halfPageDown":
      case "halfPageUp":
      case "scrollTop":
      case "scrollBottom": {
        const target = scrollTarget(doc, [lastPointer, deepActiveElement(doc)], regionRect());
        if (target !== undefined) scroll(target, action, settings.scrollStep, repeat);
        return;
      }
      case "hints":
      case "hintsNewTab":
        startHints(action === "hintsNewTab");
        return;
      case "focusInput":
        focusInput(doc, { selector: inputSelector, lastEditable, near: lastPointer ?? deepActiveElement(doc) });
        return;
      case "help":
        toggleHelp();
        return;
    }
  };

  // ---- keyboard ----------------------------------------------------------

  const normalKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const pressed = strokeFromEvent(event);
    if (pressed === undefined) return;
    const focus = focusState(guards, composedTarget(event) ?? deepActiveElement(doc));
    const midSequence = keyState.prefix.length > 0;
    const bare = !isChord(pressed) && !midSequence;
    if (focus === "blocked" || (bare && (focus === "typing" || !settings.bareKeys))) {
      keyState = EMPTY_STATE;
      return;
    }
    const [next, step] = feed(keymap, keyState, pressed, now());
    keyState = next;
    if (step.kind === "miss") return;
    swallow(event);
    if (step.kind !== "match") return;
    const action = step.binding.action;
    if (event.repeat && !ACTION_INFO[action].repeats) return;
    run(action, event.repeat);
  };

  const helpKey = (event: KeyboardEvent) => {
    const pressed = strokeFromEvent(event);
    const bound = parseSequence(settings.keys.help);
    const isHelpKey =
      pressed !== undefined &&
      Result.isSuccess(bound) &&
      bound.success.length === 1 &&
      formatSequence(bound.success) === formatSequence([pressed]);
    if (event.key === "Escape" || event.key === "q" || isHelpKey) toggleHelp();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const mode = current(stack);
    if (!ownsKeyboard(mode)) {
      if (!event.isComposing) normalKey(event);
      return;
    }
    // Hint and help own the keyboard: nothing reaches the page while they are up.
    swallow(event);
    if (event.isComposing) return;
    if (mode === "hint") hintKey(event);
    else helpKey(event);
  };

  root.run(
    Effect.gen(function* () {
      yield* listen<KeyboardEvent>(win, "keydown", onKeyDown, { capture: true });
      yield* listen<PointerEvent>(
        win,
        "pointerdown",
        (event) => {
          lastPointer = composedTarget(event);
          if (session !== undefined) endHints();
          if (current(stack) === "help") toggleHelp();
        },
        { capture: true, passive: true },
      );
      yield* listen<FocusEvent>(
        doc,
        "focusin",
        (event) => {
          const target = composedTarget(event);
          if (target !== null && isEditable(target)) lastEditable = target;
        },
        { capture: true },
      );
      yield* listen(win, "blur", () => {
        // Focus moving into a frame blurs the window too; only leaving the app ends hints.
        schedule(0, () => {
          if (!doc.hasFocus()) endHints();
        });
      });
    }),
  );

  if (options.settings !== undefined) applySettings(options.settings);

  const bbim: Bbim = {
    run: (action) => run(action),
    setSettings: applySettings,
    mode: () => current(stack),
    dispose: () => {
      session = undefined;
      // Let go of the page's elements: a disposed engine may outlive its page.
      lastPointer = null;
      lastEditable = null;
      root.close();
    },
  };
  if (options.signal !== undefined) {
    if (options.signal.aborted) bbim.dispose();
    else root.run(listen(options.signal, "abort", () => bbim.dispose(), { once: true }));
  }
  return bbim;
}
