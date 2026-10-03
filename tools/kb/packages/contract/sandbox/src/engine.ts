/**
 * The engine port (DESIGN.md → Sandbox → Engines): a bounded JavaScript realm
 * with a string pipe. An engine runs the guest's script ({@link guestScript}),
 * hands the guest one message per turn, and passes on what the guest sends;
 * the capability API is the prelude above the pipe and the host below it, so
 * both engines offer the same one. QuickJS-wasm runs untrusted code and a
 * Worker runs trusted code; `sandboxContract` in `@kb/test-kit` holds both to
 * the same properties.
 */
import { Clock, Deferred, Effect, Queue, type Cause, type Scope } from "effect";
import type { EngineKind, SandboxLimits } from "./limits.ts";
import type { EndReason, GuestEnd } from "./protocol.ts";

/** One run: the guest's code, the node it is shown for, and its bounds. */
export interface GuestSpec {
  readonly code: string;
  readonly subject: string | null;
  readonly limits: SandboxLimits;
}

/** A started run, as its host drives it. */
export interface GuestSession {
  /** Hand the guest one message, as one turn. Nothing happens once the run has ended. */
  readonly deliver: (message: string) => Effect.Effect<void>;
  /** What the guest sends, in order; it ends when the run does. */
  readonly outbox: Queue.Dequeue<string, Cause.Done>;
  /** Why the run ended, once it has. */
  readonly ended: Effect.Effect<GuestEnd>;
  /** Whether the run has ended: what the guest sent before it did is no longer heard. */
  readonly over: () => boolean;
  /** End the run now, as `stopped`. */
  readonly stop: Effect.Effect<void>;
}

export interface SandboxEngine {
  readonly kind: EngineKind;
  /**
   * Start a run of `spec`: its first turn runs the guest's script. Closing
   * the scope stops it.
   */
  readonly start: (spec: GuestSpec) => Effect.Effect<GuestSession, never, Scope.Scope>;
}

/** The message a run ends with for each reason, given what the engine reported. */
export function endOf(reason: EndReason, limits: SandboxLimits, detail = ""): GuestEnd {
  const messages: Readonly<Record<EndReason, string>> = {
    stopped: "The run was stopped.",
    interrupted: `The code ran longer than ${String(limits.turnMs)} ms in one turn and was interrupted.`,
    "out-of-memory": `The code used more than ${String(Math.round((limits.memoryBytes ?? 0) / 1024 / 1024))} MB and was stopped.`,
    error: `The code threw: ${detail}`,
    flood: `The code sent more than ${String(limits.messagesPerSecond)} messages in a second and was stopped.`,
    oversized: `The code sent a message longer than ${String(limits.maxMessageChars)} characters and was stopped.`,
  };
  return { reason, message: messages[reason] };
}

/**
 * Why a failure whose text is `text` ends a run: a heap exhausted or a turn
 * interrupted reads the same in QuickJS and in a Worker's runtime, however
 * the failure reached the host (the engine saw it, or the guest's own code
 * caught it and reported it).
 */
export function endOfFailure(text: string, limits: SandboxLimits): GuestEnd {
  if (/out of memory/i.test(text)) return endOf("out-of-memory", limits);
  if (text.startsWith("InternalError: interrupted")) return endOf("interrupted", limits);
  return endOf("error", limits, text.slice(0, 1000));
}

/**
 * What both engines keep the same way: the outbox, the end, and the bounds
 * on what the guest sends. An engine calls {@link SessionCore.accept} with
 * each message the moment the guest sends it, so a flood or an oversized
 * message ends the run before the next one.
 */
export interface SessionCore {
  readonly outbox: Queue.Queue<string, Cause.Done>;
  readonly ended: Effect.Effect<GuestEnd>;
  /** Whether the run has ended. */
  readonly over: () => boolean;
  /** Take one message from the guest; false when it ended the run. */
  readonly accept: (text: string) => boolean;
  /** End the run with `end` unless it has already ended. */
  readonly finish: (end: GuestEnd) => void;
}

export const makeSessionCore = Effect.fn("sandbox.makeSessionCore")(function* (
  limits: SandboxLimits,
): Effect.fn.Return<SessionCore> {
  const outbox = yield* Queue.unbounded<string, Cause.Done>();
  const done = yield* Deferred.make<GuestEnd>();
  const clock = yield* Clock.Clock;
  let windowStart = clock.currentTimeMillisUnsafe();
  let inWindow = 0;
  const finish = (end: GuestEnd): void => {
    if (!Deferred.doneUnsafe(done, Effect.succeed(end))) return;
    Queue.endUnsafe(outbox);
  };
  const over = () => Deferred.isDoneUnsafe(done);
  return {
    outbox,
    ended: Deferred.await(done),
    over,
    finish,
    accept: (text) => {
      if (over()) return false;
      if (text.length > limits.maxMessageChars) {
        finish(endOf("oversized", limits));
        return false;
      }
      const now = clock.currentTimeMillisUnsafe();
      if (now - windowStart >= 1000) {
        windowStart = now;
        inWindow = 0;
      }
      inWindow += 1;
      if (inWindow > limits.messagesPerSecond) {
        finish(endOf("flood", limits));
        return false;
      }
      return Queue.offerUnsafe(outbox, text);
    },
  };
});
