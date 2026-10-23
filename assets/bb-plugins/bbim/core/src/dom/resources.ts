// DOM resources as scoped acquisitions: each is released when its scope closes.
import { Effect, type Scope } from "effect";

/** An event listener, removed when the scope closes. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- E types the handler for callers, as addEventListener's overloads do.
export const listen = <E extends Event>(
  target: EventTarget,
  type: string,
  handler: (event: E) => void,
  options: AddEventListenerOptions = {},
): Effect.Effect<void, never, Scope.Scope> => {
  const listener = (event: Event) => handler(event as E);
  return Effect.acquireRelease(
    Effect.sync(() => target.addEventListener(type, listener, options)),
    () => Effect.sync(() => target.removeEventListener(type, listener, options)),
  );
};

/** A node appended to a parent, removed when the scope closes. */
export const attach = <N extends Node>(parent: Node, child: N): Effect.Effect<N, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => parent.appendChild(child)),
    (node) => Effect.sync(() => node.parentNode?.removeChild(node)),
  );

/**
 * A callback coalesced to one run per animation frame; a pending frame is
 * cancelled when the scope closes.
 */
export const frameThrottle = Effect.fn("frameThrottle")(function* (win: Window, callback: () => void) {
    let pending: number | undefined;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (pending !== undefined) win.cancelAnimationFrame(pending);
      }),
    );
    return () => {
      if (pending !== undefined) return;
      pending = win.requestAnimationFrame(() => {
        pending = undefined;
        callback();
      });
    };
});

/**
 * A set of timers that all clear when the scope closes. Returns `schedule`,
 * which runs `callback` after `ms` unless the scope closed first.
 */
export const timers = Effect.fn("timers")(function* (win: Window) {
    const live = new Set<number>();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const id of live) win.clearTimeout(id);
        live.clear();
      }),
    );
    return (ms: number, callback: () => void) => {
      const id = win.setTimeout(() => {
        live.delete(id);
        callback();
      }, ms);
      live.add(id);
    };
});
