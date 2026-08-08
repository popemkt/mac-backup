import { create } from "zustand";
import type { WsStatus } from "@/api/ws";

export type AppView = "outline" | "query";

export interface Toast {
  id: number;
  kind: "error" | "info";
  text: string;
}

interface UiState {
  view: AppView;
  wsStatus: WsStatus;
  toasts: Toast[];

  setView: (view: AppView) => void;
  setWsStatus: (status: WsStatus) => void;
  pushToast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

export const useUiStore = create<UiState>((set) => ({
  view: "outline",
  wsStatus: "idle",
  toasts: [],

  setView: (view) => set({ view }),
  setWsStatus: (wsStatus) => set({ wsStatus }),

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
