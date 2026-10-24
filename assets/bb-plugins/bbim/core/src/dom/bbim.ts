// createBbim: the key engine, pick sessions, overlay, frames and scrolling
// composed over one window. Everything it acquires lives in one scope;
// `dispose` closes it. Keydown handling is plain synchronous code (the hot
// path); only acquiring and releasing go through Effect.
//
// Every labeled choice is one mechanism, a pick session: a Picker says which
// targets get labels and what picking one does; the session owns labels,
// the overlay, narrowing, frames and the bridge. Link hints are one picker.
import { Effect, Option, Result } from "effect";
import { ACTION_INFO, ACTIONS, type Action } from "../domain/actions.ts";
import {
  formatSequence,
  isChord,
  type KeyEventLike,
  parseSequence,
  stroke,
  strokeFromEvent,
  strokeId,
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
import { type ActivateContext, activateElement, focusForTyping } from "./activate.ts";
import {
  BRIDGE_PROTOCOL,
  decodeFrameMessage,
  isBridgeMessage,
  MODE_HEARTBEAT_MS,
  MODE_TTL_MS,
  type ParentMessage,
} from "../domain/protocol.ts";
import {
  activateRemote,
  awaitOpen,
  collectRemote,
  type FrameBudget,
  frameBudget,
  iframeRemote,
  listenForwarded,
  type PageView,
  pageRemote,
  type RemoteFrame,
  type RemoteTarget,
  setRemoteMode,
} from "./bridge-client.ts";
import {
  collectTargets,
  DEFAULT_SELECTORS,
  type DocumentPlacement,
  isRendered,
  isUncovered,
  viewportOf,
  visibleBox,
} from "./collect.ts";
import { deepActiveElement, editableGuard, type FocusGuard, focusState, isEditable } from "./focus.ts";
import { frameTree, liveFrame, liveRect, placementCache } from "./frames.ts";
import { type HelpModel, type HelpSection, mountOverlay, type Overlay, type Theme } from "./overlay.ts";
import { inputFields, preferredInput, TEXT_INPUT_SELECTOR } from "./inputs.ts";
import { frameThrottle, listen, timers } from "./resources.ts";
import { openScope, type ScopeHandle } from "./runtime.ts";
import { isScrollable, scroll, scrollSurfaces, scrollTarget } from "./scroll.ts";
import { containsAcrossShadow } from "./tree.ts";

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
  /** The inputs `gi` labels; defaults to every text input. */
  readonly inputSelector?: string;
  /** Inputs `gi` means by default (first label, Enter) when none was used last; bb: its composers. */
  readonly preferInput?: string;
  /** Aborting it disposes bbim. */
  readonly signal?: AbortSignal;
  /**
   * Chords the host binds itself (bb: its commands), in vim notation
   * (`<A-f>`). A native page (attachPage) keeps every key typed in it, so it
   * passes these back and they run their action there. Letters and digits only.
   */
  readonly hostChords?: ReadonlyArray<{ readonly keys: string; readonly action: Action }>;
  /**
   * How long frames speaking the hint bridge have to answer. The page's own
   * labels show at once; a frame's join when it answers, until a key is typed.
   */
  readonly bridgeTimeoutMs?: number;
}

export interface Bbim {
  /** Run an action as if its key was pressed. */
  run(action: Action): void;
  /** Replace settings, keys included; returns what was invalid (and fell back). */
  setSettings(input: SettingsInput): ReadonlyArray<SettingsProblem>;
  mode(): Mode;
  /**
   * Hint a page the host shows in a native view over `view.element` (bb's
   * Browser tab): its targets join every hint session, it draws their labels,
   * and the host's chords typed in it come back. Returns the detach.
   */
  attachPage(view: PageView): () => void;
  dispose(): void;
}

/** A labeled choice: an element of this page (or a same-origin frame), or one a bridge frame reported. */
type Target =
  | {
      readonly source: "local";
      readonly element: Element;
      /** How activating it behaves; undefined for targets a picker does not activate (a scroll surface). */
      readonly kind: TargetKind | undefined;
      readonly rect: Rect;
      readonly faded: boolean;
    }
  | {
      readonly source: "remote";
      readonly remote: RemoteTarget;
      readonly kind: TargetKind;
      readonly rect: Rect;
      readonly faded: boolean;
    };

type LocalTarget = Extract<Target, { readonly source: "local" }>;

/**
 * One kind of pick session: which targets get labels and what picking one
 * does. Labels, narrowing, the overlay, frames and the bridge belong to the
 * session, so a picker is only these decisions.
 */
interface Picker {
  /** The page candidates in one document; same-origin frames are documents too. */
  readonly collect: (placement: DocumentPlacement) => ReadonlyArray<LocalTarget>;
  /** Whether bridge frames are asked for their targets as well. */
  readonly remote: boolean;
  /** Outline each target and put its label inside the top-left corner (a pane, not a control). */
  readonly outline: boolean;
  /** With exactly one target and no frames to ask, pick it without showing labels. */
  readonly pickSingle: boolean;
  /** Which target gets the first, shortest label and is what Enter picks; none when undefined. */
  readonly first?: (targets: ReadonlyArray<Target>) => number | undefined;
  /** Act on the picked target; `newTab` when Shift was on the last letter or the session asked for it. */
  readonly pick: (target: Target, how: { readonly newTab: boolean; readonly requestId: string }) => void;
}

interface PickSession {
  readonly picker: Picker;
  readonly scope: ScopeHandle;
  readonly newTab: boolean;
  readonly requestId: string;
  readonly frames: ReadonlyArray<RemoteFrame>;
  /** The native pages among `frames`: a new document in one ends the session. */
  readonly pages: ReadonlyArray<PageView>;
  /** The native page whose chord started the session: labeling again keeps it forwarding. */
  readonly fromPage: PageView | undefined;
  /** The frame element that had focus when hints started, if any. */
  readonly startFrame: Element | null;
  /** The bridge frame that had focus: the only one asked to forward keys. */
  readonly focusedFrame: RemoteFrame | undefined;
  /** How many more messages each bridge frame may send this session, for targets and for keys. */
  readonly collectBudget: FrameBudget;
  readonly keyBudget: FrameBudget;
  /** Labels and their targets once any are shown; undefined while only frames may answer. */
  assigned: ReadonlyArray<{ readonly label: string; readonly target: Target }> | undefined;
  /** Where each assigned label was last drawn (top-level px), by label index. */
  drawn: ReadonlyArray<Rect | undefined>;
  keymap: Keymap<number> | undefined;
  /** Only the focused bridge frame's labels: what keys it forwards may match. */
  frameKeymap: Keymap<number> | undefined;
  state: MatchState;
  /** Whether Enter picks the first label (the picker named one). */
  enterPicks: boolean;
  /** Keys typed before the labels showed up, replayed when they do. */
  readonly queued: Array<{ readonly event: KeyEventLike; readonly from: RemoteFrame | undefined }>;
}

const HINT_KEYS_LIMIT = 16;
/** How far a target may drift from its label before activating it re-labels instead. */
const MOVED_PX = 4;
/** How long a bridge frame has to answer a new-tab activation with its URL. */
const OPEN_REPLY_MS = 1000;
/**
 * How often attached native pages get the host's chords again. A reload or
 * navigation drops the page bridge; the next delivery installs it again, so
 * chords work in a new document within this long, whatever the host noticed.
 */
const PAGE_KEEPALIVE_MS = 2000;
/** The most messages the chord listener reads from one page per keep-alive period. */
const PAGE_MESSAGE_BUDGET = 64;

function swallow(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/** `element` when it is a frame element (focus inside a frame shows there). */
function frameElement(element: Element | null): Element | null {
  return element?.tagName === "IFRAME" ? element : null;
}

/** The session's native pages, which draw their own labels. */
function nativeFrames(active: PickSession): ReadonlyArray<RemoteFrame> {
  return active.frames.filter((frame) => frame.native);
}

/** A native page covers the overlay where it shows: it draws its own targets' labels. */
function elsewhere(target: Target): boolean {
  return target.source === "remote" && target.remote.frame.native;
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

/** Leave nothing behind in a page let go of: no chords, no labels, no forwarding. */
function releasePage(view: PageView): void {
  view.send({ bbim: BRIDGE_PROTOCOL, type: "chords", chords: [] });
  view.send({ bbim: BRIDGE_PROTOCOL, type: "labels", labels: [] });
  view.send({ bbim: BRIDGE_PROTOCOL, type: "mode", active: false, requestId: "" });
}

type ChordCode = Extract<ParentMessage, { readonly type: "chords" }>["chords"][number];

/**
 * A host chord as a native page matches it (by physical key, as alt chords
 * are on macOS) and as the engine compares it; undefined unless it is one
 * chord on a letter or digit.
 */
function pageChord(keys: string): { readonly id: string; readonly code: ChordCode } | undefined {
  const parsed = parseSequence(keys);
  const only = Result.isSuccess(parsed) && parsed.success.length === 1 ? parsed.success[0] : undefined;
  if (only === undefined || !isChord(only)) return undefined;
  const letter = /^[a-z]$/iu.test(only.key);
  if (!letter && !/^[0-9]$/u.test(only.key)) return undefined;
  const code = letter ? `Key${only.key.toUpperCase()}` : `Digit${only.key}`;
  return {
    id: strokeId(only),
    code: { code, ctrlKey: only.ctrl, altKey: only.alt, metaKey: only.meta, shiftKey: letter && only.key !== only.key.toLowerCase() },
  };
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
          { label: "gi: the input you used last", keys: ["Enter"] },
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
  const bridgeTimeoutMs = options.bridgeTimeoutMs ?? 1000;
  const root = openScope();

  let settings: Settings = DEFAULT_SETTINGS;
  let problems: ReadonlyArray<string> = [];
  let keymap: Keymap<Action> = compileKeymap(keyBindings(settings));
  let keyState: MatchState = EMPTY_STATE;
  let stack: ModeStack = INITIAL_STACK;
  let session: PickSession | undefined;
  let lastPointer: Element | null = null;
  let lastEditable: Element | null = null;
  /** The surface `gs` picked: j/k/d/u/gg/G scroll it until a click lands outside it. */
  let scrollFocus: Element | undefined;
  let requests = 0;
  /** Native pages the host attached (attachPage): remote frames over its own window. */
  const pages = new Map<
    PageView,
    {
      /** Stops hearing the page. */
      readonly stop: () => void;
      /** Its bridge's document, as last announced (`ready`). */
      document: string | undefined;
      /** Messages read from it this keep-alive period. */
      spent: number;
    }
  >();
  const hostChords = (options.hostChords ?? []).flatMap(({ keys, action }) => {
    const chord = pageChord(keys);
    return chord === undefined ? [] : [{ ...chord, action }];
  });

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

  /** Whether a target gets a label: hover-only ones unless the settings hide them. */
  const shows = (target: { readonly faded: boolean }) => !target.faded || settings.fadedTargets === "show";

  const regionRect = (): Rect | undefined => {
    const element = regionOf(doc, lastPointer ?? deepActiveElement(doc));
    if (element === null) return undefined;
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width, height: box.height };
  };

  // ---- hints -------------------------------------------------------------

  /** Narrow every label to `prefix`: the overlay's, and those native pages draw. */
  const narrowTo = (active: PickSession, prefix: string) => {
    overlay.narrow(prefix);
    for (const frame of nativeFrames(active)) frame.post({ bbim: BRIDGE_PROTOCOL, type: "typed", typed: prefix });
  };

  const endHints = () => {
    const ending = session;
    if (ending === undefined) return;
    session = undefined;
    stack = leave(stack, "hint");
    overlay.hideHints();
    for (const frame of nativeFrames(ending)) frame.post({ bbim: BRIDGE_PROTOCOL, type: "labels", labels: [] });
    ending.scope.close();
  };

  /**
   * Whether a local target is still where its label showed it: connected,
   * rendered, on screen, not painted over, and not moved. The page has no
   * observer on it while hints are up, so this is checked at activation.
   */
  const stillThere = (element: Element, drawn: Rect | undefined): boolean => {
    if (drawn === undefined || !element.isConnected || !isRendered(element)) return false;
    const shown = visibleBox(element, viewportOf(element.ownerDocument));
    if (shown === undefined || !isUncovered(element.ownerDocument, element, shown)) return false;
    const live = liveRect(placementCache(doc), element);
    return live !== undefined && Math.abs(live.left - drawn.left) <= MOVED_PX && Math.abs(live.top - drawn.top) <= MOVED_PX;
  };

  /** What picking a link hint does: follow, click, focus or open, here or in the bridge frame that reported it. */
  const activate = (target: Target, { newTab, requestId }: { readonly newTab: boolean; readonly requestId: string }) => {
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
    lastPointer = target.element;
    if (target.kind === undefined) return;
    const context: ActivateContext = { newTab, ...(hooks.openUrl === undefined ? {} : { openUrl: hooks.openUrl }) };
    activateElement(target.element, target.kind, context);
  };

  const linkHints: Picker = {
    collect: (placement) =>
      collectTargets(placement, { selectors, exclude: (element) => element === overlay.host }).map(
        (target): LocalTarget => ({ source: "local", ...target }),
      ),
    remote: true,
    outline: false,
    pickSingle: false,
    pick: activate,
  };

  const isOverlay = (element: Element) => element === overlay.host || element.getRootNode() === overlay.host.shadowRoot;

  /** Scroll surfaces: picking one makes it what the scroll keys move. */
  const scrollPicker: Picker = {
    collect: (placement) =>
      scrollSurfaces(placement, isOverlay).map(
        ({ element, rect }): LocalTarget => ({ source: "local", element, kind: undefined, rect, faded: false }),
      ),
    remote: false,
    outline: true,
    pickSingle: true,
    pick: (target) => {
      if (target.source !== "local") return;
      scrollFocus = target.element;
      overlay.flash(target.rect);
    },
  };

  /** Text inputs: the one `gi` means by default gets the first label, and Enter. */
  const inputPicker: Picker = {
    collect: (placement) =>
      inputFields(placement, inputSelector).map(
        ({ element, rect }): LocalTarget => ({ source: "local", element, kind: undefined, rect, faded: false }),
      ),
    remote: false,
    outline: false,
    pickSingle: true,
    first: (targets) => {
      const fields = targets.flatMap((target) => (target.source === "local" ? [target] : []));
      const preferred = preferredInput(fields, {
        lastEditable,
        near: lastPointer ?? deepActiveElement(doc),
        ...(options.preferInput === undefined ? {} : { prefer: options.preferInput }),
      });
      const index = targets.findIndex((target) => target.source === "local" && target.element === preferred);
      return index < 0 ? undefined : index;
    },
    pick: (target) => {
      if (target.source === "local") focusForTyping(target.element);
    },
  };

  /** Pick the target labeled `index`, or label again when the page moved under it. */
  const choose = (active: PickSession, index: number, newTab: boolean) => {
    const chosen = active.assigned?.[index];
    endHints();
    if (chosen === undefined) return;
    if (chosen.target.source === "local" && !stillThere(chosen.target.element, active.drawn[index])) {
      // The page changed under the labels (moved, covered, gone): label it again.
      startPick(active.picker, newTab, active.fromPage);
      return;
    }
    active.picker.pick(chosen.target, { newTab, requestId: active.requestId });
  };

  /** A key typed in hint mode; `from` is the bridge frame it was typed in, if any. */
  const hintKey = (event: KeyEventLike, from?: RemoteFrame) => {
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
    // A native page's keys are a person's own (see RemoteFrame.native); an iframe's are not.
    const trusted = from === undefined || from.native;
    if (event.key === "Enter") {
      // Enter takes the first label, the picker's default (gi: the last input used).
      if (trusted && active.enterPicks && active.state.prefix.length === 0) choose(active, 0, active.newTab);
      return;
    }
    if (event.key === "Backspace") {
      // A frame may take back only letters of its own labels.
      if (!trusted && (active.frameKeymap === undefined || !within(active.frameKeymap, active.state))) return;
      active.state = back(active.state);
      narrowTo(active, typed(active.keymap, active.state));
      return;
    }
    const pressed = strokeFromEvent(event);
    if (pressed === undefined || isChord(pressed)) return;
    // Keys a frame forwards are matched against that frame's own labels only,
    // before anything changes: they cannot pick, narrow or reset the page's.
    const map = trusted ? active.keymap : active.frameKeymap;
    if (map === undefined) return;
    const [next, step] = feed(map, active.state, pressed, now());
    if (step.kind === "miss") return;
    active.state = next;
    if (step.kind === "pending") narrowTo(active, typed(active.keymap, next));
    if (step.kind !== "match") return;
    choose(active, step.binding.action, active.newTab || event.shiftKey);
  };

  const showLabels = (active: PickSession, targets: ReadonlyArray<Target>) => {
    if (session !== active) return;
    if (targets.length === 0) {
      endHints();
      return;
    }
    const first = active.picker.first?.(targets);
    const byPlace = order(targets, regionRect());
    const ordered = first === undefined ? byPlace : [first, ...byPlace.filter((index) => index !== first)];
    active.enterPicks = first !== undefined;
    const labels = generateLabels(ordered.length, settings.hintAlphabet);
    const assigned = labels.flatMap((label, rank) => {
      const target = targets[ordered[rank] ?? -1];
      return target === undefined ? [] : [{ label, target }];
    });
    active.assigned = assigned;
    active.drawn = assigned.map(({ target }) => target.rect);
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
    const { outline } = active.picker;
    overlay.showHints(
      assigned.map(({ label, target }) => ({ label, rect: target.rect, faded: target.faded, outline, elsewhere: elsewhere(target) })),
    );
    for (const frame of nativeFrames(active)) {
      const own = assigned.flatMap(({ label, target }) =>
        target.source === "remote" && target.remote.frame === frame ? [{ id: target.remote.id, label }] : [],
      );
      frame.post({ bbim: BRIDGE_PROTOCOL, type: "labels", labels: own });
    }
    for (const queued of active.queued.splice(0)) hintKey(queued.event, queued.from);
  };

  const reposition = () => {
    const active = session;
    if (active?.assigned === undefined) return;
    // Each document's and frame's placement once per reposition (one per animation
    // frame), not once per label; a document scrolled away hides all its labels.
    const place = placementCache(doc);
    const frames = new Map<RemoteFrame, RemoteFrame | undefined>();
    active.drawn = active.assigned.map(({ target }) => {
      if (target.source === "local") return liveRect(place, target.element);
      const before = target.remote.frame;
      // A native page draws (and keeps placing) its own labels.
      if (before.native) return undefined;
      if (!frames.has(before)) frames.set(before, liveFrame(place, before));
      const after = frames.get(before);
      if (after === undefined) return undefined;
      return {
        left: target.rect.left + after.offsetX - before.offsetX,
        top: target.rect.top + after.offsetY - before.offsetY,
        width: target.rect.width,
        height: target.rect.height,
      };
    });
    overlay.reposition(active.drawn);
  };

  /**
   * Start a pick session for `picker`; the same key again while one is up
   * ends it. `fromPage` is the native page whose chord started it: focus is
   * in that page, so it forwards the keys typed next.
   */
  const startPick = (picker: Picker, newTab: boolean, fromPage?: PageView) => {
    if (session !== undefined) {
      endHints();
      return;
    }
    stack = leave(stack, "help");
    overlay.hideHelp();
    const tree = frameTree(doc);
    const local: Array<Target> = tree.documents.flatMap((placement) => picker.collect(placement).filter(shows));
    requests += 1;
    const only = local[0];
    if (picker.pickSingle && !picker.remote && local.length === 1 && only !== undefined) {
      picker.pick(only, { newTab, requestId: `bbim-${requests}` });
      return;
    }
    const remotes = tree.opaque.map(iframeRemote);
    const shownPages = [...pages].flatMap(([view, page]) => {
      const frame = pageRemote(view, () => page.document);
      return frame === undefined ? [] : [{ view, frame }];
    });
    const startPage = shownPages.find(({ view }) => view === fromPage)?.frame;
    const active: PickSession = {
      picker,
      scope: root.child(),
      newTab,
      requestId: `bbim-${requests}`,
      frames: picker.remote ? [...remotes, ...shownPages.map(({ frame }) => frame)] : [],
      pages: shownPages.map(({ view }) => view),
      fromPage,
      startFrame: frameElement(doc.activeElement),
      focusedFrame: startPage ?? remotes.find((frame) => deepActiveElement(doc) === frame.element),
      collectBudget: frameBudget(),
      keyBudget: frameBudget(),
      assigned: undefined,
      drawn: [],
      keymap: undefined,
      frameKeymap: undefined,
      state: EMPTY_STATE,
      enterPicks: false,
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
            setRemoteMode(focused, true, active.requestId);
            beat(MODE_HEARTBEAT_MS, renew);
          };
          renew();
          yield* Effect.addFinalizer(() => Effect.sync(() => setRemoteMode(focused, false, active.requestId)));
          const onLeave = () => {
            // A click in a native page is a click outside the picked surface.
            if (focused.native) scrollFocus = undefined;
            endHints();
          };
          yield* listenForwarded(focused, { onKey: (event) => hintKey(event, focused), onLeave }, active.keyBudget);
        }
      }),
    );
    if (active.frames.length === 0) {
      showLabels(active, local);
      return;
    }
    // The page's labels show at once and each frame's join as it answers, but
    // only until a key is typed: labels never change under a half-typed one.
    const withRemote = (remote: ReadonlyArray<RemoteTarget>) => [
      ...local,
      ...remote.flatMap((target): Array<Target> =>
        shows(target) ? [{ source: "remote", remote: target, kind: target.kind, rect: target.rect, faded: target.faded }] : [],
      ),
    ];
    const relabel = (targets: ReadonlyArray<Target>) => {
      if (targets.length > 0 && active.state.prefix.length === 0) showLabels(active, targets);
    };
    relabel(local);
    active.scope.fork(
      Effect.map(
        collectRemote(active.frames, active.requestId, bridgeTimeoutMs, active.collectBudget, (sofar) =>
          relabel(withRemote(sofar)),
        ),
        (remote) => {
          if (active.assigned === undefined) showLabels(active, withRemote(remote));
          else relabel(withRemote(remote));
        },
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

  const run = (action: Action, repeat = false, fromPage?: PageView) => {
    switch (action) {
      case "scrollDown":
      case "scrollUp":
      case "halfPageDown":
      case "halfPageUp":
      case "scrollTop":
      case "scrollBottom": {
        const picked = scrollFocus?.isConnected === true && isScrollable(scrollFocus) ? scrollFocus : undefined;
        const target = picked ?? scrollTarget(doc, [lastPointer, deepActiveElement(doc)], regionRect());
        if (target !== undefined) scroll(target, action, settings.scrollStep, repeat);
        return;
      }
      case "hints":
      case "hintsNewTab":
        startPick(linkHints, action === "hintsNewTab", fromPage);
        return;
      case "pickScroll":
        startPick(scrollPicker, false, fromPage);
        return;
      case "focusInput":
        startPick(inputPicker, false, fromPage);
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
          // A click outside the picked surface hands scrolling back to where the click was.
          if (scrollFocus !== undefined && (lastPointer === null || !containsAcrossShadow(scrollFocus, lastPointer))) {
            scrollFocus = undefined;
          }
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

  // ---- native pages --------------------------------------------------------

  const sendChords = (view: PageView) =>
    view.send({ bbim: BRIDGE_PROTOCOL, type: "chords", chords: hostChords.map(({ code }) => code) });

  let keepingAlive = false;
  const keepAlive = () => {
    if (pages.size === 0) {
      keepingAlive = false;
      return;
    }
    for (const [view, page] of pages) {
      page.spent = 0;
      if (view.element.isConnected) sendChords(view);
    }
    schedule(PAGE_KEEPALIVE_MS, keepAlive);
  };

  /** What a page sends outside a session's own listeners: its new documents, and the host's chords typed in it. */
  const pageMessage = (view: PageView, data: unknown) => {
    const page = pages.get(view);
    if (page === undefined || !isBridgeMessage(data, ["key", "ready"])) return;
    if (page.spent >= PAGE_MESSAGE_BUDGET) return;
    page.spent += 1;
    const message = decodeFrameMessage(data);
    if (message?.type === "ready") {
      // A new document: a session it was part of lost its targets and labels with the old one.
      // (The first one announced is the page's first: nothing was labeled in another.)
      const replaced = page.document !== undefined && message.document !== page.document;
      if (replaced && session?.pages.includes(view) === true) endHints();
      page.document = message.document;
      return;
    }
    if (message?.type !== "key" || message.repeat || message.isComposing) return;
    const pressed = strokeFromEvent(message);
    const chord = pressed === undefined ? undefined : hostChords.find(({ id }) => id === strokeId(pressed));
    if (chord !== undefined) run(chord.action, false, view);
  };

  const attachPage = (view: PageView) => {
    pages.get(view)?.stop();
    // Focus in the page keeps the host's chords from the host: the page passes them back.
    const stop = view.listen((data) => pageMessage(view, data));
    const page = { stop, document: undefined, spent: 0 };
    pages.set(view, page);
    sendChords(view);
    if (!keepingAlive) {
      keepingAlive = true;
      schedule(PAGE_KEEPALIVE_MS, keepAlive);
    }
    return () => {
      if (pages.get(view) !== page) return;
      pages.delete(view);
      stop();
      if (session?.pages.includes(view) === true) endHints();
      releasePage(view);
    };
  };

  const bbim: Bbim = {
    run: (action) => run(action),
    setSettings: applySettings,
    mode: () => current(stack),
    attachPage,
    dispose: () => {
      for (const [view, page] of pages) {
        page.stop();
        releasePage(view);
      }
      pages.clear();
      session = undefined;
      // Let go of the page's elements: a disposed engine may outlive its page.
      lastPointer = null;
      lastEditable = null;
      scrollFocus = undefined;
      root.close();
    },
  };
  if (options.signal !== undefined) {
    if (options.signal.aborted) bbim.dispose();
    else root.run(listen(options.signal, "abort", () => bbim.dispose(), { once: true }));
  }
  return bbim;
}
