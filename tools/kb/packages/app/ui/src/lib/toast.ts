import { logError } from "@/lib/log";

/**
 * The user-notification sink.
 *
 * `lib` is the UI's leaf zone and cannot reach the store that renders toasts —
 * and it is the only zone every caller of `toast()` can reach: `actions`,
 * `session` and `lib` have no `stores` row, and a surface has no `api` row, so
 * moving this onto `ui.store`'s surface would trade one breach for four. The
 * direction inverts instead: this module declares the sink, and
 * `stores/ui.store` registers itself when it loads, which is the direction
 * every other row of the matrix states.
 */
export type ToastSink = (message: string) => void;

let sink: ToastSink | null = null;

export function setToastSink(next: ToastSink): void {
  sink = next;
}

/**
 * Show `message` to the user. Loud rather than silent with no sink: a dropped
 * error toast is a real hole, so it is at least visible in the console.
 */
export function toast(message: string): void {
  if (sink === null) {
    logError("[kb/toast] no sink registered; message dropped:", message);
    return;
  }
  sink(message);
}
