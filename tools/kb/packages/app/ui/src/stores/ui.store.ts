import { create } from "zustand";
import type { WsStatus } from "@/api/ws";
import { setToastSink } from "@/lib/toast";

export interface Toast {
  id: number;
  kind: "error" | "info";
  text: string;
  /** How many times this same message arrived while it was on screen. */
  count: number;
}

/** At most this many toasts show at once; the oldest yields. */
export const TOAST_LIMIT = 3;
const TOAST_MS = 6000;

/**
 * The toast list after `incoming` arrives. A message already on screen is not
 * stacked a second time: it moves to the newest slot with its count raised
 * (and a fresh id, so its timer restarts). The list keeps the newest
 * `TOAST_LIMIT`.
 */
export function withToast(
  toasts: readonly Toast[],
  incoming: { id: number; kind: Toast["kind"]; text: string },
): Toast[] {
  const same = (t: Toast) => t.kind === incoming.kind && t.text === incoming.text;
  const count = (toasts.find(same)?.count ?? 0) + 1;
  return [...toasts.filter((t) => !same(t)), { ...incoming, count }].slice(-TOAST_LIMIT);
}

interface UiState {
  wsStatus: WsStatus;
  toasts: Toast[];
  /** Preferences popover (DESIGN-RESKIN §1.7) — header button + palette. */
  prefsOpen: boolean;
  globalPaletteOpen: boolean;
  nodePaletteOpen: boolean;
  /** W7.1: open filter popover for this frame (toolbar ⚙ / palette Filter…). */
  filterPopoverFrameId: string | null;

  setWsStatus: (status: WsStatus) => void;
  setPrefsOpen: (open: boolean) => void;
  setGlobalPaletteOpen: (open: boolean) => void;
  setNodePaletteOpen: (open: boolean) => void;
  setFilterPopoverFrameId: (frameId: string | null) => void;
  pushToast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

export const useUiStore = create<UiState>((set) => ({
  wsStatus: "idle",
  toasts: [],
  prefsOpen: false,
  globalPaletteOpen: false,
  nodePaletteOpen: false,
  filterPopoverFrameId: null,

  setWsStatus: (wsStatus) => set({ wsStatus }),
  setPrefsOpen: (prefsOpen) => set({ prefsOpen }),
  setGlobalPaletteOpen: (globalPaletteOpen) =>
    set((s) => ({
      globalPaletteOpen,
      nodePaletteOpen: globalPaletteOpen ? false : s.nodePaletteOpen,
    })),
  setNodePaletteOpen: (nodePaletteOpen) =>
    set((s) => ({
      nodePaletteOpen,
      globalPaletteOpen: nodePaletteOpen ? false : s.globalPaletteOpen,
    })),
  setFilterPopoverFrameId: (filterPopoverFrameId) => set({ filterPopoverFrameId }),

  pushToast: (kind, text) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: withToast(s.toasts, { id, kind, text }) }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, TOAST_MS);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/**
 * The store is the toast sink `lib/toast` declares. Registered at module scope
 * rather than from a boot step: `toast()` is called from zones that may not
 * reach a store, and every code path that can render a toast has already
 * imported this module — App renders `<Toasts/>` from it.
 */
setToastSink((message) => {
  useUiStore.getState().pushToast("error", message);
});
