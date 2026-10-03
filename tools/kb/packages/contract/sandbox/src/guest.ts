/**
 * Driving one run (DESIGN.md → Sandbox): what the frame does in the browser
 * and what a `ui://` snapshot does on the server, stated once. It starts the
 * engine, decodes every message the guest sends, draws what it draws through
 * the allowlist, logs what it logs, answers its tool calls through the host's
 * capability host, and hands it events. The guest is untrusted, so a message
 * that does not decode, or a call beyond the pending bound, ends the run.
 */
import { Deferred, Effect, Exit, Queue, Result, Schedule, Schema, type Scope } from "effect";
import { MCP_APPS_METHODS } from "@kb/contracts";
import { sanitizeDrawing, type DrawingReport } from "./drawing.ts";
import { endOfFailure, type GuestSpec, type SandboxEngine } from "./engine.ts";
import {
  GuestMessage,
  KB_METHODS,
  errorMessage,
  notification,
  resultMessage,
  type GuestEnd,
  type KbEvent,
  type LogLevel,
  type ToolCall,
  type ToolResult,
} from "./protocol.ts";

/** What a run's host does with what the guest sends. */
export interface GuestHost {
  /** Show a drawing: what the guest drew, through the allowlist. */
  readonly draw: (drawing: DrawingReport) => Effect.Effect<void>;
  readonly log: (level: LogLevel, text: string) => Effect.Effect<void>;
  /** Answer one tool call: a registry action, through the capability host. */
  readonly callTool: (call: ToolCall) => Effect.Effect<ToolResult>;
}

/** A run as its host drives it. */
export interface GuestRun {
  /** Hand the guest an event. */
  readonly event: (event: KbEvent) => Effect.Effect<void>;
  /** Why the run ended, once it has. */
  readonly ended: Effect.Effect<GuestEnd>;
  /** Whether the run has ended. */
  readonly over: Effect.Effect<boolean>;
  /**
   * Wait until the run is quiet — no call waits on the host and nothing the
   * guest sent is unread — or has ended: how a snapshot knows the drawing is
   * the code's last word.
   */
  readonly settled: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
}

/** How often `settled` looks again while the guest is still busy. */
const SETTLE_POLL_MS = 10;

const decodeGuestMessage = Schema.decodeUnknownResult(Schema.fromJsonString(GuestMessage));

export const runGuest = Effect.fn("sandbox.runGuest")(function* (
  engine: SandboxEngine,
  spec: GuestSpec,
  host: GuestHost,
): Effect.fn.Return<GuestRun, never, Scope.Scope> {
  const session = yield* engine.start(spec);
  const ended = yield* Deferred.make<GuestEnd>();
  // Calls waiting on the host, and messages taken but not yet acted on.
  let pending = 0;
  let handling = 0;

  const fail = (end: GuestEnd) => Effect.andThen(Deferred.succeed(ended, end), session.stop);

  const answer = (id: string | number, call: ToolCall) =>
    Effect.gen(function* () {
      const result = yield* host.callTool(call).pipe(Effect.exit);
      const reply = Exit.isSuccess(result)
        ? resultMessage(id, result.value)
        : errorMessage(id, "the host could not answer this call");
      yield* session.deliver(JSON.stringify(reply));
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          pending -= 1;
        }),
      ),
    );

  const call = (id: string | number, params: ToolCall) =>
    Effect.suspend(() => {
      if (pending >= spec.limits.maxPendingCalls) {
        return fail({
          reason: "flood",
          message: `The code had more than ${String(spec.limits.maxPendingCalls)} calls waiting at once and was stopped.`,
        });
      }
      pending += 1;
      return Effect.asVoid(Effect.forkScoped(answer(id, params)));
    });

  /** What one decoded message does. */
  const act = (message: GuestMessage): Effect.Effect<void, never, Scope.Scope> => {
    if (message.method === MCP_APPS_METHODS.toolsCall) return call(message.id, message.params);
    if (message.method === KB_METHODS.draw) {
      return host.draw(sanitizeDrawing(message.params.drawing, spec.limits.maxDrawNodes));
    }
    if (message.method === MCP_APPS_METHODS.log) {
      return host.log(message.params.level, message.params.data);
    }
    return fail(endOfFailure(message.params.message, spec.limits));
  };

  const handle = (text: string) =>
    Effect.suspend(() => {
      if (session.over()) return Effect.void;
      const decoded = decodeGuestMessage(text);
      return Result.isSuccess(decoded)
        ? act(decoded.success)
        : fail({ reason: "error", message: "The code sent a message kb cannot read." });
    });

  // The guest's messages, in order, until its outbox ends with the run.
  yield* Effect.forkScoped(
    Effect.forever(
      Effect.flatMap(Queue.take(session.outbox), (text) => {
        handling += 1;
        return Effect.ensuring(
          handle(text),
          Effect.sync(() => {
            handling -= 1;
          }),
        );
      }),
    ).pipe(
      Effect.ignore,
      Effect.andThen(Effect.flatMap(session.ended, (end) => Deferred.succeed(ended, end))),
    ),
  );

  return {
    event: (event) => session.deliver(JSON.stringify(notification(KB_METHODS.event, event))),
    ended: Deferred.await(ended),
    over: Deferred.isDone(ended),
    settled: Effect.raceFirst(
      // Quiet: nothing waits on the host, and nothing the guest sent is unread.
      Effect.repeat(
        Effect.sync(
          () => pending === 0 && handling === 0 && Queue.sizeUnsafe(session.outbox) === 0,
        ),
        { until: (quiet) => quiet, schedule: Schedule.spaced(SETTLE_POLL_MS) },
      ),
      Effect.asVoid(Deferred.await(ended)),
    ).pipe(Effect.asVoid),
    stop: session.stop,
  };
});
