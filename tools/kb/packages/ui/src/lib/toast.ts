import { useUiStore } from "@/stores/ui.store";

/**
 * Single toast system: the ui store owns toast state and App's <Toasts/>
 * renders it. This shim keeps the mutations/optimistic call sites terse.
 */
export function toast(message: string): void {
  useUiStore.getState().pushToast("error", message);
}
