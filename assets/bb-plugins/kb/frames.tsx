// bb-plugin-kb — the window's kb frames. bb mounts a thread panel tab only while it is the active tab of a
// shown thread and keys it by thread, so a frame inside the tab is destroyed on every thread switch and kb
// loads again from nothing. The frames live here instead, in an app overlay bb mounts once per window: each
// recently shown thread keeps its own kb frame (lib/frames.ts), and a thread's panel tab is only the place its
// frame is drawn over. A frame is never moved in the DOM, since moving an iframe reloads it; it is positioned
// over its thread's place while that place is mounted, and hidden (and inert) while it is not.
//
// GAP [[01M5QN6PKBQ5YE4FNB1PYPXR92]] bb's SDK cannot keep a panel tab mounted; this overlay stands in for it.
// What says so, in @get-bb/plugin-sdk 0.6.49 and bb-app 0.47.0:
// - bundled-types/bb-plugin-sdk-app.d.ts: `PluginThreadPanelActionRegistration` is `{ id, title, icon?,
//   component, layout?, run? }` and `PluginThreadPanelProps` is `{ threadId, params }`: no option keeps a tab
//   mounted or hands it a slot that outlives it. `experimental_appOverlay` is the one slot mounted once per
//   window (`ExperimentalAppOverlayProps`).
// - app/dist/assets/ThreadSecondaryPanel-*.js renders only the active tab (`x.renderContent(w)` for the tab
//   whose id is the active one), and usePanelTerminals-*.js keys a plugin tab's mount by
//   `thread/<threadId>/<tab id>`, so another thread, or another tab, unmounts it.
// - app/dist/assets/index-*.js renders app overlays once, keyed `<pluginId>/<id>/<generation>`, in a
//   `data-bb-plugin-app-overlays` element of class `contents` (no box, no stacking context of its own).
//
// Each frame is its own kb tab with its own session (kb DESIGN.md → Surfaces → Embedding the page). Only a
// shown frame is its thread's tab for the agent: a thread whose frame is hidden has no tab, so its agent acts
// tabless (skills/kb/SKILL.md), as it would with the panel closed, rather than steering a tab nobody sees.
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { KeptFrames } from "./lib/frames";
import { originOf, SESSION_HEARTBEAT_MS, sessionOfMessage } from "./lib/kb";

type Config = { readonly url: string | null; readonly autoOpen: boolean };

/**
 * Above the thread view the frame covers, below everything bb draws over a thread view. Read from bb-app
 * 0.47.0's bundled classes: the main column is `max-md:z-30` and panel resize handles `z-[25]`
 * (ThreadSecondaryPanel-*.js, SplitWorkspaceRoute-*.js); the mobile sidebar scrim and floating thread
 * controls are `z-40` (index-*.js, SplitWorkspaceRoute-*.js); popovers, menus, tooltips, dialogs, drawers, the
 * title bar and the iframe drag guard are `z-50`, update overlays `z-60` and up. No bb class sits in 31-39.
 * bbim's hint layer is 2147483647 (bbim core/src/dom/label-layer.ts) and bb-lively's layer 60, both above.
 */
const FRAME_Z_INDEX = 35;

/** The window's frames, the places their threads' panels give them, and what each frame's kb tab said. */
class FrameStore {
  config: Config | null = null;
  readonly kept = new KeptFrames();
  /** Each thread's mounted places, latest last: a thread shown in two panes draws in the one shown last. */
  readonly #places = new Map<string, HTMLElement[]>();
  /** Each kept thread's frame element, while it is mounted. */
  readonly #elements = new Map<string, HTMLIFrameElement>();
  /** The session each frame's kb tab said, shown or hidden. */
  readonly #sessions = new Map<string, string>();
  /** Bumped to reload a thread's frame from scratch: the frame's React key carries it. */
  readonly #generations = new Map<string, number>();
  readonly #listeners = new Set<() => void>();
  #version = 0;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly version = (): number => this.#version;

  #changed(): void {
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }

  configure(config: Config): void {
    this.config = config;
    this.#changed();
  }

  /** `threadId`'s panel gives its frame `place` to draw over, until the returned release is called. */
  claim(threadId: string, place: HTMLElement): () => void {
    this.#places.set(threadId, [...(this.#places.get(threadId) ?? []), place]);
    for (const gone of this.kept.show(threadId, new Set(this.#places.keys()))) this.#forget(gone);
    this.#changed();
    return () => {
      const left = (this.#places.get(threadId) ?? []).filter(el => el !== place);
      if (left.length === 0) this.#places.delete(threadId);
      else this.#places.set(threadId, left);
      this.#changed();
    };
  }

  /** Where `threadId`'s frame is drawn now, or null while no panel of it is mounted. */
  placeOf(threadId: string): HTMLElement | null {
    return this.#places.get(threadId)?.at(-1) ?? null;
  }

  /** Whether any frame is drawn over a place now. */
  get anyPlaced(): boolean {
    return this.#places.size > 0;
  }

  /** `threadId`'s frame element is mounted, until the returned detach is called. */
  attach(threadId: string, frame: HTMLIFrameElement): () => void {
    this.#elements.set(threadId, frame);
    return () => {
      if (this.#elements.get(threadId) === frame) this.#elements.delete(threadId);
    };
  }

  /** The mounted frame elements, by thread. */
  get elements(): ReadonlyMap<string, HTMLIFrameElement> {
    return this.#elements;
  }

  /** What `threadId`'s kb tab said its session is, whether or not its frame is shown. */
  sessionOf(threadId: string): string | null {
    return this.#sessions.get(threadId) ?? null;
  }

  setSession(threadId: string, session: string | null): void {
    if (session === null) this.#sessions.delete(threadId);
    else this.#sessions.set(threadId, session);
    this.#changed();
  }

  /** Each thread's tab for its agent: the session of every thread whose frame is shown now. */
  tabs(): ReadonlyMap<string, string> {
    const tabs = new Map<string, string>();
    for (const [threadId, session] of this.#sessions) {
      if (this.#places.has(threadId)) tabs.set(threadId, session);
    }
    return tabs;
  }

  generationOf(threadId: string): number {
    return this.#generations.get(threadId) ?? 0;
  }

  /** Load `threadId`'s kb tab again from scratch: a new frame, and a new session once it says it. */
  reload(threadId: string): void {
    this.#generations.set(threadId, this.generationOf(threadId) + 1);
    this.#sessions.delete(threadId);
    this.#changed();
  }

  #forget(threadId: string): void {
    this.#generations.delete(threadId);
    this.#sessions.delete(threadId);
  }
}

/** This window's frames: module state, which lives as long as the plugin's generation in this window. */
export const frames = new FrameStore();

/** Re-render on any change to the frames. */
export function useFrames(): FrameStore {
  useSyncExternalStore(frames.subscribe, frames.version);
  return frames;
}

/** Start the window's connection to kb's origin before any thread opens its panel. */
function preconnect(origin: string): void {
  if (document.head.querySelector(`link[rel="preconnect"][href="${origin}"]`) !== null) return;
  const link = document.createElement("link");
  link.rel = "preconnect";
  link.href = origin;
  link.crossOrigin = "";
  document.head.appendChild(link);
}

const HIDDEN: CSSProperties = {
  position: "fixed",
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  border: 0,
  visibility: "hidden",
  pointerEvents: "none",
  zIndex: FRAME_Z_INDEX,
};

type Box = { left: number; top: number; right: number; bottom: number };

/** What a frame was last drawn as, so an unchanged frame costs no writes. */
type Drawn = { key: string; place: HTMLElement | null; sized: string; clips: readonly HTMLElement[] };

const drawn = new WeakMap<HTMLIFrameElement, Drawn>();

/** The place's ancestors that clip what overflows them: the frame shows only inside all of them. */
function clippingAncestors(place: HTMLElement): HTMLElement[] {
  const clips: HTMLElement[] = [];
  for (let el = place.parentElement; el !== null && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") clips.push(el);
  }
  return clips;
}

/** `el`'s padding box in the viewport: where its overflow is clipped, scrollbars excluded. */
function paddingBox(el: HTMLElement): Box {
  const rect = el.getBoundingClientRect();
  const left = rect.left + el.clientLeft;
  const top = rect.top + el.clientTop;
  return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight };
}

function hide(frame: HTMLIFrameElement, state: Drawn): void {
  if (state.key === "hidden") return;
  // Its last size stays, so the hidden page does not lay itself out again when it is shown.
  frame.style.visibility = "hidden";
  frame.style.pointerEvents = "none";
  frame.inert = true;
  state.key = "hidden";
}

/**
 * Draw `frame` over its thread's place: the place's box, clipped to the place's clipping ancestors (a fixed
 * frame escapes their overflow otherwise, and paints over the UI beside a scrolled or narrowed panel).
 */
function follow(frame: HTMLIFrameElement, place: HTMLElement | null): void {
  const state = drawn.get(frame) ?? { key: "", place: null, sized: "", clips: [] };
  drawn.set(frame, state);
  if (place === null || !place.isConnected) {
    state.place = null;
    hide(frame, state);
    return;
  }
  const rect = place.getBoundingClientRect();
  const sized = `${rect.width},${rect.height}`;
  // A clipping ancestor changes with the layout: found again when the place changes or resizes.
  if (state.place !== place || state.sized !== sized) {
    state.place = place;
    state.sized = sized;
    state.clips = clippingAncestors(place);
  }
  const seen: Box = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  for (const clip of state.clips) {
    const box = paddingBox(clip);
    seen.left = Math.max(seen.left, box.left);
    seen.top = Math.max(seen.top, box.top);
    seen.right = Math.min(seen.right, box.right);
    seen.bottom = Math.min(seen.bottom, box.bottom);
  }
  if (rect.width <= 0 || rect.height <= 0 || seen.right <= seen.left || seen.bottom <= seen.top) {
    hide(frame, state);
    return;
  }
  const inset = [seen.top - rect.top, rect.right - seen.right, rect.bottom - seen.bottom, seen.left - rect.left];
  const key = `${rect.left},${rect.top},${rect.width},${rect.height}|${inset.join(",")}`;
  if (key === state.key) return;
  state.key = key;
  frame.style.left = `${rect.left}px`;
  frame.style.top = `${rect.top}px`;
  frame.style.width = `${rect.width}px`;
  frame.style.height = `${rect.height}px`;
  // clip-path also clips hit testing, so the clipped-off part takes no clicks either.
  frame.style.clipPath = inset.every(side => side <= 0) ? "none" : `inset(${inset.map(side => `${side}px`).join(" ")})`;
  frame.style.visibility = "visible";
  frame.style.pointerEvents = "auto";
  frame.inert = false;
}

function KbFrame({ threadId, url, origin }: { threadId: string; url: string; origin: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null);

  useLayoutEffect(() => {
    const frame = ref.current;
    if (frame === null) return;
    const detach = frames.attach(threadId, frame);
    follow(frame, frames.placeOf(threadId));
    return detach;
  }, [threadId]);

  // The frame posts its session once it knows the origins allowed to frame it, and again when its id is
  // renewed. Only a message from this frame, from kb's origin, is taken.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== ref.current?.contentWindow) return;
      const next = sessionOfMessage(event.data);
      if (next !== null) frames.setSession(threadId, next);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin, threadId]);

  return (
    <iframe
      ref={ref}
      src={url}
      title="kb"
      style={HIDDEN}
      className="bg-background"
      allow="clipboard-read; clipboard-write; fullscreen"
      data-kb-thread={threadId}
    />
  );
}

/**
 * The app overlay: reads the plugin's config once per window, opens the connection to kb early, draws the
 * kept frames over their places, and reports each thread's tab to the backend.
 */
export function KbFrameHost() {
  const rpc = useRpc<typeof rpcContract>();
  const store = useFrames();
  const url = store.config?.url ?? null;
  const origin = url === null ? null : originOf(url);
  const anyPlaced = store.anyPlaced;

  useEffect(() => {
    let current = true;
    rpc.call("config", {}).then(
      next => current && frames.configure(next),
      () => current && frames.configure({ url: null, autoOpen: false }),
    );
    return () => {
      current = false;
    };
  }, [rpc]);

  useEffect(() => {
    if (origin !== null) preconnect(origin);
  }, [origin]);

  // The one place a thread's tab is reported: whenever the frames change, each thread whose tab is new or
  // changed is reported with it and each that lost its tab with null; every beat repeats the tabs, so the
  // backend lets them lapse once this window is gone without saying so. Changes made together (one thread's
  // panel going and the next one's coming) are reported once they settle.
  useEffect(() => {
    const reported = new Map<string, string>();
    const report = (threadId: string, session: string | null) =>
      void rpc.call("reportSession", { threadId, session }).catch(() => undefined);
    let live = true;
    let queued = false;
    const sync = () => {
      queued = false;
      if (!live) return;
      const tabs = frames.tabs();
      for (const [threadId, session] of tabs) {
        if (reported.get(threadId) === session) continue;
        reported.set(threadId, session);
        report(threadId, session);
      }
      for (const threadId of [...reported.keys()]) {
        if (tabs.has(threadId)) continue;
        reported.delete(threadId);
        report(threadId, null);
      }
    };
    const unsubscribe = frames.subscribe(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(sync);
    });
    sync();
    const timer = setInterval(() => {
      for (const [threadId, session] of reported) report(threadId, session);
    }, SESSION_HEARTBEAT_MS);
    return () => {
      live = false;
      unsubscribe();
      clearInterval(timer);
      for (const threadId of reported.keys()) report(threadId, null);
    };
  }, [rpc]);

  // One loop draws every frame, each animation frame while any frame is placed, and idles otherwise. A place
  // moves without resizing (a sidebar, a split pane, an ancestor's scroll, bb's transitions), which a
  // ResizeObserver does not report; the loop reads each shown frame's place and writes only what changed.
  useEffect(() => {
    const drawAll = () => {
      for (const [threadId, frame] of frames.elements) follow(frame, frames.placeOf(threadId));
    };
    drawAll();
    if (!anyPlaced) return;
    let handle = requestAnimationFrame(function step() {
      drawAll();
      handle = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(handle);
  }, [anyPlaced]);

  if (url === null || origin === null) return null;
  return (
    <div data-kb-frames="" className="contents">
      {store.kept.made.map(threadId => (
        <KbFrame key={`${threadId}#${store.generationOf(threadId)}`} threadId={threadId} url={url} origin={origin} />
      ))}
    </div>
  );
}
