// bb-plugin-kb — the window's kb frames. bb mounts a thread panel tab only while it is the active tab of a
// shown thread and keys it by thread, so a frame inside the tab is destroyed on every thread switch and kb
// loads again from nothing. The frames live here instead, in an app overlay bb mounts once per window: each
// recently shown thread keeps its own kb frame (lib/frames.ts), and a thread's panel tab is only the place its
// frame is drawn over. A frame is never moved in the DOM, since moving an iframe reloads it; it is positioned
// over its thread's place while that place is mounted, and hidden (and inert) while it is not.
//
// GAP [[01M5QN6PKBQ5YE4FNB1PYPXR92]] bb's SDK cannot keep a panel tab mounted; this overlay stands in for it.
//
// Each frame is its own kb tab with its own session (kb DESIGN.md → Surfaces → Embedding the page): the frame
// reports it for its thread while it lives, shown or hidden, as a background browser tab stays a tab.
import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { KeptFrames } from "./lib/frames";
import { originOf, SESSION_HEARTBEAT_MS, sessionOfMessage } from "./lib/kb";

type Config = { readonly url: string | null; readonly autoOpen: boolean };

/** Above the thread view it covers, below bb's popovers, menus and dialogs (z-50). */
const FRAME_Z_INDEX = 40;

/** The window's frames, the places their threads' panels give them, and what each frame's kb tab said. */
class FrameStore {
  config: Config | null = null;
  readonly kept = new KeptFrames();
  /** Each thread's mounted places, latest last: a thread shown in two panes draws in the one shown last. */
  readonly #places = new Map<string, HTMLElement[]>();
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

  sessionOf(threadId: string): string | null {
    return this.#sessions.get(threadId) ?? null;
  }

  get sessions(): ReadonlyMap<string, string> {
    return this.#sessions;
  }

  setSession(threadId: string, session: string | null): void {
    if (session === null) this.#sessions.delete(threadId);
    else this.#sessions.set(threadId, session);
    this.#changed();
  }

  generationOf(threadId: string): number {
    return this.#generations.get(threadId) ?? 0;
  }

  /** Load `threadId`'s kb tab again from scratch: a new frame, and a new session once it says it. */
  reload(threadId: string): void {
    this.#generations.set(threadId, this.generationOf(threadId) + 1);
    this.#sessionGone(threadId);
    this.#changed();
  }

  #forget(threadId: string): void {
    this.#generations.delete(threadId);
    this.#sessionGone(threadId);
  }

  #sessionGone(threadId: string): void {
    if (this.#sessions.delete(threadId)) this.onSessionGone?.(threadId);
  }

  /** Told when a thread's kb tab goes (its frame is dropped or reloaded), so its session is reported gone. */
  onSessionGone: ((threadId: string) => void) | null = null;
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

/** Keep `frame` over its thread's place, every animation frame while the window draws any frame. */
function follow(frame: HTMLIFrameElement, place: HTMLElement | null, last: { key: string }): void {
  if (place === null || !place.isConnected) {
    if (last.key !== "hidden") {
      // Its last size stays, so the hidden page does not lay itself out again when it is shown.
      frame.style.visibility = "hidden";
      frame.style.pointerEvents = "none";
      frame.inert = true;
      last.key = "hidden";
    }
    return;
  }
  const rect = place.getBoundingClientRect();
  const key = `${rect.left},${rect.top},${rect.width},${rect.height}`;
  if (key === last.key) return;
  last.key = key;
  const shown = rect.width > 0 && rect.height > 0;
  frame.style.left = `${rect.left}px`;
  frame.style.top = `${rect.top}px`;
  if (shown) {
    frame.style.width = `${rect.width}px`;
    frame.style.height = `${rect.height}px`;
  }
  frame.style.visibility = shown ? "visible" : "hidden";
  frame.style.pointerEvents = shown ? "auto" : "none";
  frame.inert = !shown;
}

function KbFrame({ threadId, url, origin }: { threadId: string; url: string; origin: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null);

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

  // Follow the thread's place while any frame is placed; idle otherwise.
  const anyPlaced = useFrames().anyPlaced;
  useEffect(() => {
    const frame = ref.current;
    if (frame === null) return;
    const last = { key: "" };
    follow(frame, frames.placeOf(threadId), last);
    if (!anyPlaced) return;
    let handle = requestAnimationFrame(function step() {
      follow(frame, frames.placeOf(threadId), last);
      handle = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(handle);
  }, [anyPlaced, threadId]);

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
 * kept frames, and reports each frame's session for its thread while the frame lives.
 */
export function KbFrameHost() {
  const rpc = useRpc<typeof rpcContract>();
  const store = useFrames();
  const url = store.config?.url ?? null;
  const origin = url === null ? null : originOf(url);

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

  // Report every live frame's session, repeated so the backend lets it lapse once this window is gone
  // without saying so; say so when a frame goes.
  useEffect(() => {
    const report = (threadId: string, session: string | null) =>
      void rpc.call("reportSession", { threadId, session }).catch(() => undefined);
    frames.onSessionGone = threadId => report(threadId, null);
    const timer = setInterval(() => {
      for (const [threadId, session] of frames.sessions) report(threadId, session);
    }, SESSION_HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      frames.onSessionGone = null;
      for (const threadId of frames.sessions.keys()) report(threadId, null);
    };
  }, [rpc]);

  // A session is reported the moment its frame says it, not only on the next beat.
  const sessions = [...store.sessions].map(([threadId, session]) => `${threadId}=${session}`).join(",");
  useEffect(() => {
    for (const [threadId, session] of frames.sessions) {
      void rpc.call("reportSession", { threadId, session }).catch(() => undefined);
    }
  }, [rpc, sessions]);

  if (url === null || origin === null) return null;
  return (
    <div data-kb-frames="" className="contents">
      {store.kept.made.map(threadId => (
        <KbFrame key={`${threadId}#${store.generationOf(threadId)}`} threadId={threadId} url={url} origin={origin} />
      ))}
    </div>
  );
}
