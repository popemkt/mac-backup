// The frontend's shared state for one bundle generation in one window: each thread's standing stop
// as last fetched (null: checked, none), and the sidebar row-status setter the content script got.
// The app-wide sync (adapter/sync.tsx) fills it; the thread header badge (adapter/badge.tsx) reads it.
import type { PluginComposerThreadRowStatus } from "@get-bb/plugin-sdk/app";
import type { StopView } from "../core/stops.ts";

type Listener = () => void;

export interface StopStore {
  /** undefined: not fetched yet; null: fetched, no standing stop. */
  get(threadId: string): StopView | null | undefined;
  /** Every thread fetched so far. */
  known(): readonly string[];
  /** Bumped on every change, for useSyncExternalStore. */
  version(): number;
  set(entries: Iterable<readonly [string, StopView | null]>): void;
  subscribe(listener: Listener): () => void;
}

export function createStopStore(): StopStore {
  const views = new Map<string, StopView | null>();
  const listeners = new Set<Listener>();
  let version = 0;
  const notify = (): void => {
    version++;
    for (const listener of listeners) listener();
  };
  return {
    get: (threadId) => views.get(threadId),
    known: () => [...views.keys()],
    version: () => version,
    set(entries) {
      let changed = false;
      for (const [threadId, view] of entries) {
        if (views.get(threadId) === view) continue;
        views.set(threadId, view);
        changed = true;
      }
      if (changed) notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type RowStatusSetter = (threadId: string, status: PluginComposerThreadRowStatus | null) => void;

/** The content script's setter, while its generation is mounted (null on older bb clients). */
export const rowStatus: { setter: RowStatusSetter | null; listeners: Set<Listener> } = {
  setter: null,
  listeners: new Set(),
};

export function setRowStatusSetter(setter: RowStatusSetter | null): void {
  rowStatus.setter = setter;
  for (const listener of rowStatus.listeners) listener();
}

export const stopStore = createStopStore();
