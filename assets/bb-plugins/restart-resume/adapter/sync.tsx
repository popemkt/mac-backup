// The app-wide sync, mounted once per window as an invisible overlay: fetches the standing stop of
// every thread in the sidebar (and any thread a header asks about), refetches one thread when the
// server's `stops` signal names it and everything after a reconnect, and mirrors the result onto
// bb's sidebar rows through the content script's setter. No polling.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  experimental_useSidebarThreads,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import {
  batches,
  present,
  type RowStatus,
  rowStatusChanges,
  rowStatusOf,
  STOPS_BATCH,
  STOPS_CHANNEL,
} from "../core/stops.ts";
import type { rpcContract } from "../server.ts";
import { rowStatus, stopStore } from "./store.ts";

/** Fetch the stops of these threads into the store. Shared by the sync and the header badge. */
export function useFetchStops(): (threadIds: readonly string[]) => Promise<void> {
  const rpc = useRpc<typeof rpcContract>();
  return useCallback(
    async (threadIds) => {
      for (const batch of batches([...new Set(threadIds)], STOPS_BATCH)) {
        const { stops, checked } = await rpc.call("stops", { threadIds: batch });
        const byId = new Map(stops.map((stop) => [stop.threadId, stop]));
        stopStore.set(checked.map((threadId) => [threadId, byId.get(threadId) ?? null] as const));
      }
    },
    [rpc],
  );
}

const subscribeSetter = (listener: () => void): (() => void) => {
  rowStatus.listeners.add(listener);
  return () => void rowStatus.listeners.delete(listener);
};

export function StopsSync(): null {
  const { threads } = experimental_useSidebarThreads();
  const fetchStops = useFetchStops();
  const views = useSyncExternalStore(stopStore.subscribe, stopStore.version);
  const setter = useSyncExternalStore(subscribeSetter, () => rowStatus.setter);
  const connection = useRealtimeConnectionState();
  const wasReconnecting = useRef(false);
  const applied = useRef(new Map<string, RowStatus>());

  const warn = useCallback((error: unknown) => {
    console.warn("[restart-resume] could not load thread stops", error);
  }, []);

  // Threads new to the store: one batched fetch.
  const liveIds = threads.filter((thread) => !thread.isArchived).map((thread) => thread.id);
  const liveKey = liveIds.join(",");
  useEffect(() => {
    const unknown = liveKey === "" ? [] : liveKey.split(",").filter((id) => stopStore.get(id) === undefined);
    if (unknown.length > 0) fetchStops(unknown).catch(warn);
  }, [liveKey, fetchStops, warn]);

  // The server names a thread whose stop may have changed.
  useRealtime(STOPS_CHANNEL, (payload) => {
    const threadId = typeof payload === "object" && payload !== null ? (payload as { threadId?: unknown }).threadId : null;
    if (typeof threadId === "string") fetchStops([threadId]).catch(warn);
  });

  // Signals are not replayed: after a reconnect, refetch everything known.
  useEffect(() => {
    if (connection === "reconnecting") wasReconnecting.current = true;
    else if (connection === "connected" && wasReconnecting.current) {
      wasReconnecting.current = false;
      fetchStops(stopStore.known()).catch(warn);
    }
  }, [connection, fetchStops, warn]);

  // Mirror onto the sidebar rows. Re-derived when stops, statuses, or the setter change.
  const statusKey = threads.map((thread) => `${thread.id}:${thread.status}`).join(",");
  useEffect(() => {
    if (setter === null) {
      applied.current.clear();
      return;
    }
    const now = Date.now();
    const desired = new Map<string, RowStatus>();
    for (const thread of threads) {
      if (thread.isArchived) continue;
      const view = stopStore.get(thread.id);
      if (view) desired.set(thread.id, rowStatusOf(present(view, thread.status, now)));
    }
    for (const [threadId, row] of rowStatusChanges(applied.current, desired)) {
      setter(threadId, row);
      if (row === null) applied.current.delete(threadId);
      else applied.current.set(threadId, row);
    }
    // threads is read through statusKey; views through the store version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey, views, setter]);

  return null;
}
