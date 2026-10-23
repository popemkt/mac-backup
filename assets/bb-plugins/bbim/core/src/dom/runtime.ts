// The one place Effect meets imperative callers: DOM event handlers, a host's
// mount/dispose hooks, React effects. Everything bbim acquires (listeners,
// nodes, observers, timers) is acquired into a Scope; disposing is closing it.
import { Effect, Exit, type Fiber, Scope } from "effect";

export interface ScopeHandle {
  readonly scope: Scope.Closeable;
  /** Run a synchronous effect, acquiring its resources into this scope. */
  run<A>(effect: Effect.Effect<A, never, Scope.Scope>): A;
  /** Start an asynchronous effect that this scope interrupts when it closes. */
  fork<A>(effect: Effect.Effect<A, never, Scope.Scope>): Fiber.Fiber<A>;
  /** A child scope, closed with this one if not before. */
  child(): ScopeHandle;
  /** Release everything acquired, in reverse order. Idempotent. */
  close(): void;
  readonly closed: () => boolean;
}

function handle(scope: Scope.Closeable): ScopeHandle {
  let closed = false;
  const self: ScopeHandle = {
    scope,
    run: (effect) => Effect.runSync(Scope.provide(scope)(effect)),
    fork: (effect) => Effect.runSync(Effect.forkIn(Scope.provide(scope)(effect), scope)),
    child: () => handle(Scope.forkUnsafe(scope, "sequential")),
    close: () => {
      if (closed) return;
      closed = true;
      Effect.runSync(Scope.close(scope, Exit.void));
    },
    closed: () => closed,
  };
  return self;
}

/** A fresh root scope. */
export function openScope(): ScopeHandle {
  return handle(Scope.makeUnsafe("sequential"));
}
