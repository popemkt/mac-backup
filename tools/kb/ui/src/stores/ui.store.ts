import { create } from "zustand";
import type { WsStatus } from "@/api/ws";

export interface Toast {
  id: number;
  kind: "error" | "info";
  text: string;
}

interface UiState {
  wsStatus: WsStatus;
  toasts: Toast[];
  /** Preferences popover (DESIGN-RESKIN §1.7) — header button + palette. */
  prefsOpen: boolean;
  globalPaletteOpen: boolean;
  nodePaletteOpen: boolean;

  setWsStatus: (status: WsStatus) => void;
  setPrefsOpen: (open: boolean) => void;
  setGlobalPaletteOpen: (open: boolean) => void;
  setNodePaletteOpen: (open: boolean) => void;
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

  pushToast: (kind, text) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }].slice(-5) }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 6000);
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
