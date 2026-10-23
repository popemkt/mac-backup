// createBbim: the key engine, hints, overlay, frames and scrolling composed
// over one window. Everything it acquires lives in one scope; `dispose`
// closes it. Keydown handling is plain synchronous code (the hot path); only
// acquiring and releasing go through Effect.
import { Effect, Option, Result } from "effect";
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
  expire,
  feed,
  type Keymap,
  type MatchState,
  typed,
  within,
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
import { MODE_HEARTBEAT_MS, MODE_TTL_MS } from "../domain/protocol.ts";
import {
  activateRemote,
  awaitOpen,
  collectRemote,
  type FrameBudget,
  frameBudget,
  listenForwarded,
  type RemoteTarget,
  setRemoteMode,
} from "./bridge-client.ts";
import { collectTargets, DEFAULT_SELECTORS, viewportOf } from "./collect.ts";
import { deepActiveElement, editableGuard, type FocusGuard, focusState, isEditable } from "./focus.ts";
import { frameTree, liveFrame, liveRect, type OpaqueFrame, placementCache } from "./frames.ts";
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
  /** The frame element that had focus when hints started, if any. */
  readonly startFrame: Element | null;
  /** The bridge frame that had focus: the only one asked to forward keys. */
  readonly focusedFrame: OpaqueFrame | undefined;
  /** How many more messages each bridge frame may send this session, for targets and for keys. */
  readonly collectBudget: FrameBudget;
  readonly keyBudget: FrameBudget;
  /** Labels and their targets once collected; undefined while frames answer. */
  assigned: ReadonlyArray<{ readonly label: string; readonly target: Target }> | undefined;
  keymap: Keymap<number> | undefined;
  /** Only the focused bridge frame's labels: what keys it forwards may match. */
  frameKeymap: Keymap<number> | undefined;
  state: MatchState;
  /** Keys typed before the labels showed up, replayed when they do. */
  readonly queued: Array<{ readonly event: KeyEventLike; readonly from: OpaqueFrame | undefined }>;
}

const HINT_KEYS_LIMIT = 16;
/** How long a bridge frame has to answer a new-tab activation with its URL. */
const OPEN_REPLY_MS = 1000;

function swallow(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/** `element` when it is a frame element (focus inside a frame shows there). */
function frameElement(element: Element | null): Element | null {
  return element?.tagName === "IFRAME" ? element : null;
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
      const { frame } = target.remote;
      activateRemote(target.remote, requestId, newTab);
      // A sandboxed frame may not open tabs itself: its one answer to this
      // activation may ask us to. Nothing else a frame sends opens anything.
      if (newTab) {
        root.fork(
          Effect.map(awaitOpen(frame, requestId, OPEN_REPLY_MS), (url) => {
            if (Option.isSome(url) && hooks.openUrl?.(url.value, { newTab: true }) !== true) {
              win.open(url.value, "_blank", "noopener,noreferrer");
            }
          }),
        );
      }
      return;
    }
    if (!target.element.isConnected) {
      // The page changed under the labels (no observer watches it): label it again.
      startHints(newTab);
      return;
    }
    lastPointer = target.element;
    const context: ActivateContext = { newTab, ...(hooks.openUrl === undefined ? {} : { openUrl: hooks.openUrl }) };
    activateElement(target.element, target.kind, context);
  };

  /** A key typed in hint mode; `from` is the bridge frame it was typed in, if any. */
  const hintKey = (event: KeyEventLike, from?: OpaqueFrame) => {
    const active = session;
    if (active === undefined) return;
    if (event.key === "Escape") {
      endHints();
      return;
    }
    if (active.keymap === undefined || active.assigned === undefined) {
      if (active.queued.length < HINT_KEYS_LIMIT) active.queued.push({ event, from });
      return;
    }
    if (event.key === "Backspace") {
      // A frame may take back only letters of its own labels.
      if (from !== undefined && (active.frameKeymap === undefined || !within(active.frameKeymap, active.state))) return;
      active.state = back(active.state);
      overlay.narrow(typed(active.keymap, active.state));
      return;
    }
    const pressed = strokeFromEvent(event);
    if (pressed === undefined || isChord(pressed)) return;
    // Keys a frame forwards are matched against that frame's own labels only,
    // before anything changes: they cannot pick, narrow or reset the page's.
    const map = from === undefined ? active.keymap : active.frameKeymap;
    if (map === undefined) return;
    const [next, step] = feed(map, active.state, pressed, now());
    if (step.kind === "miss") return;
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
    const labelKeymap = (keep: (target: Target) => boolean) =>
      compileKeymap(
        assigned.flatMap(({ label, target }, index) =>
          keep(target) ? [{ sequence: [...label].map((char) => stroke(char)), action: index }] : [],
        ),
        { foldCase: true, restartOnMiss: false, timeoutMs: Number.POSITIVE_INFINITY },
      );
    active.keymap = labelKeymap(() => true);
    const focused = active.focusedFrame;
    active.frameKeymap =
      focused === undefined ? undefined : labelKeymap((target) => target.source === "remote" && target.remote.frame === focused);
    overlay.showHints(assigned.map(({ label, target }) => ({ label, rect: target.rect })));
    for (const queued of active.queued.splice(0)) hintKey(queued.event, queued.from);
  };

  const reposition = () => {
    const active = session;
    if (active?.assigned === undefined) return;
    // Each document's and frame's placement once per reposition (one per animation
    // frame), not once per label; a document scrolled away hides all its labels.
    const place = placementCache(doc);
    const frames = new Map<OpaqueFrame, OpaqueFrame | undefined>();
    overlay.reposition(
      active.assigned.map(({ target }) => {
        if (target.source === "local") return liveRect(place, target.element);
        const before = target.remote.frame;
        if (!frames.has(before)) frames.set(before, liveFrame(place, before));
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
      startFrame: frameElement(doc.activeElement),
      focusedFrame: tree.opaque.find((frame) => deepActiveElement(doc) === frame.element),
      collectBudget: frameBudget(),
      keyBudget: frameBudget(),
      assigned: undefined,
      keymap: undefined,
      frameKeymap: undefined,
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
            // Keys pressed while focus is inside a same-origin frame land there,
            // and so do clicks, which end hints as they do on the page itself.
            yield* listen<KeyboardEvent>(view, "keydown", (event) => {
              swallow(event);
              if (!event.repeat) hintKey(event);
            }, { capture: true });
            yield* listen(view, "pointerdown", endHints, { capture: true, passive: true });
          }
          yield* listen(view, "scroll", onScroll, { capture: true, passive: true });
        }
        yield* listen(win, "resize", endHints);
        yield* listen(doc, "visibilitychange", endHints);
        const focused = active.focusedFrame;
        if (focused !== undefined) {
          // Keys typed in the focused bridge frame stay there unless it forwards
          // them; it does only while we keep renewing, so a parent that dies
          // cannot leave it swallowing keys.
          const beat = yield* timers(win);
          let renewed = now();
          const renew = () => {
            // A renewal this late (timers throttled, the tab asleep) means the
            // frame has already given up forwarding: end hints with it.
            if (now() - renewed > MODE_TTL_MS) {
              endHints();
              return;
            }
            renewed = now();
            setRemoteMode(focused, true);
            beat(MODE_HEARTBEAT_MS, renew);
          };
          renew();
          yield* Effect.addFinalizer(() => Effect.sync(() => setRemoteMode(focused, false)));
          yield* listenForwarded(focused, { onKey: (event) => hintKey(event, focused), onLeave: endHints }, active.keyBudget);
        }
      }),
    );
    if (active.frames.length === 0) {
      showLabels(active, local);
      return;
    }
    active.scope.fork(
      Effect.map(collectRemote(active.frames, active.requestId, bridgeTimeoutMs, active.collectBudget), (remote) =>
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
    // Expire first: a `g` from long ago must not make the next key part of a sequence.
    keyState = expire(keymap, keyState, now());
    // A sequence a chord started may end on a plain key wherever focus is; a
    // plain-key sequence (gg, gi) is bare all the way, so it never eats typing.
    const first = keyState.prefix[0];
    const bare = !isChord(pressed) && (first === undefined || !isChord(first));
    const [next, step] = feed(keymap, keyState, pressed, now());
    // Only a key some binding takes asks where focus is: ordinary typing
    // never runs the guards, and a bare key stops at the first "typing".
    if (step.kind === "miss") {
      keyState = next;
      return;
    }
    const focus =
      bare && !settings.bareKeys
        ? "blocked"
        : focusState(guards, composedTarget(event) ?? deepActiveElement(doc), bare ? "typing" : "blocked");
    if (focus === "blocked" || (bare && focus === "typing")) {
      keyState = EMPTY_STATE;
      return;
    }
    keyState = next;
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
    // An input method is composing: the key is the IME's, not a command.
    // oxlint-disable-next-line typescript/no-deprecated -- keyCode 229 is how Safari and older Chromium mark IME keys.
    const composing = event.isComposing || event.key === "Process" || event.keyCode === 229;
    if (!ownsKeyboard(mode)) {
      if (!composing) normalKey(event);
      return;
    }
    // Hint and help own the keyboard: nothing reaches the page while they are up.
    swallow(event);
    if (composing || event.repeat) return;
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
          keyState = EMPTY_STATE;
          if (session !== undefined) endHints();
          if (current(stack) === "help") toggleHelp();
        },
        { capture: true, passive: true },
      );
      yield* listen<FocusEvent>(
        doc,
        "focusin",
        (event) => {
          // Focus moved: a half-typed sequence belongs to where it was typed.
          keyState = EMPTY_STATE;
          const target = composedTarget(event);
          if (target !== null && isEditable(target)) lastEditable = target;
        },
        { capture: true },
      );
      yield* listen(win, "blur", () => {
        // Leaving the app ends hints; so does a click into a frame (focus moves
        // to its element), which the page itself never sees as a pointerdown.
        schedule(0, () => {
          const frame = frameElement(doc.activeElement);
          if (!doc.hasFocus() || (frame !== null && frame !== session?.startFrame)) endHints();
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
