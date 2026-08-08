import { create } from "zustand";

export interface ToastItem {
  id: string;
  message: string;
}

interface ToastState {
  items: ToastItem[];
  push: (message: string) => void;
  dismiss: (id: string) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (message) => {
    const id = `toast-${++seq}`;
    set((s) => ({ items: [...s.items, { id, message }] }));
    setTimeout(() => {
      set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
    }, 4000);
  },
  dismiss: (id) =>
    set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export function toast(message: string): void {
  useToastStore.getState().push(message);
}
