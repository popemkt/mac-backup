/**
 * Per-node debug field visibility.
 *
 * "Show me the `sys.*` and hidden props" is a question about ONE node — you
 * ask it of the node you are looking at, the way you ask "is this row
 * expanded?". It used to be a single device-wide `showAllFields` pref, which
 * meant turning it on for one node turned every page into a schema dump; that
 * switch is gone rather than kept alongside this one.
 *
 * Storage is the same shape the expanded rows use (`loadIdSet`/`saveIdSet`) —
 * a set of node ids under its own key. This store is its only reader and
 * writer, so no component touches localStorage.
 *
 * Migration note (intentional breakage, same idiom as `loadExpandedIds`): a
 * user who had the old global switch ON has no set of ids to migrate to, so
 * debug starts off everywhere and is re-armed per node. The stale
 * `showAllFields` key inside `localStorage["kb-prefs"]` is ignored on read and
 * dropped on the next prefs write.
 */
import { create } from "zustand";
import { loadIdSet, saveIdSet } from "@/lib/graph-view";
import { DEBUG_FIELDS_STORAGE_KEY } from "@/lib/types";

interface DebugFieldsState {
  /** Node ids currently revealing their debug field rows. */
  ids: Set<string>;
  isDebug: (nodeId: string) => boolean;
  toggle: (nodeId: string) => void;
}

export const useDebugFieldsStore = create<DebugFieldsState>((set, get) => ({
  ids: loadIdSet(DEBUG_FIELDS_STORAGE_KEY),
  isDebug: (nodeId) => get().ids.has(nodeId),
  toggle: (nodeId) => {
    const next = new Set(get().ids);
    if (!next.delete(nodeId)) next.add(nodeId);
    saveIdSet(DEBUG_FIELDS_STORAGE_KEY, next);
    set({ ids: next });
  },
}));

/** Selector for one node — the shape every component consumer wants. */
export function useDebugFields(nodeId: string): boolean {
  return useDebugFieldsStore((s) => s.ids.has(nodeId));
}
