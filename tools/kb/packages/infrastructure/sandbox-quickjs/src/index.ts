/**
 * The untrusted engine (DESIGN.md → Sandbox → Engines): QuickJS compiled to
 * WebAssembly (quickjs-emscripten, MIT), one WebAssembly instance per run.
 * The guest's realm is QuickJS's: it holds the language and the prelude's
 * `kb`, and nothing of the host — no DOM, no network, no timers, no
 * `import`. QuickJS enforces the run's bounds itself: an interrupt handler
 * ends a turn that outlives `turnMs`, the runtime refuses an allocation past
 * `memoryBytes` and a frame past `stackBytes`. The variant embeds its
 * WebAssembly in the module, so a page whose CSP allows no connection still
 * loads it, and a bundle carries it with no separate asset.
 */
import { Clock, Effect, Option, Schema, type Scope } from "effect";
import variant from "@jitl/quickjs-singlefile-browser-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSHandle,
} from "quickjs-emscripten-core";
import {
  endOf,
  endOfFailure,
  guestScript,
  makeSessionCore,
  type GuestSession,
  type GuestSpec,
  type SandboxEngine,
} from "@kb/sandbox";

/** An error as QuickJS dumps it. */
const DumpedError = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  message: Schema.String,
});
const decodeDumpedError = Schema.decodeUnknownOption(DumpedError);

/** What a failed turn's error says, read defensively: after an OOM even reading it may fail. */
function errorText(context: QuickJSContext, handle: QuickJSHandle): string {
  try {
    const dumped: unknown = context.dump(handle);
    return Option.match(decodeDumpedError(dumped), {
      onNone: () => (typeof dumped === "string" ? dumped : "an error kb could not read"),
      onSome: (error) =>
        error.name === undefined ? error.message : `${error.name}: ${error.message}`,
    });
  } catch {
    return "an error kb could not read";
  }
}

const start = Effect.fn("sandbox.quickjs.start")(function* (
  spec: GuestSpec,
): Effect.fn.Return<GuestSession, never, Scope.Scope> {
  const core = yield* makeSessionCore(spec.limits);
  const clock = yield* Clock.Clock;
  const module = yield* Effect.promise(() => newQuickJSWASMModuleFromVariant(variant));
  const runtime = module.newRuntime();
  if (spec.limits.memoryBytes !== null) runtime.setMemoryLimit(spec.limits.memoryBytes);
  runtime.setMaxStackSize(spec.limits.stackBytes);
  const context = runtime.newContext();
  let deadline = Number.POSITIVE_INFINITY;
  let overran = false;
  // Polled by QuickJS as it runs: a turn past its deadline, or a run that
  // has ended (a flood, an oversized message, a stop), is cut off at once.
  // The guest's own code can catch what an interrupt throws (an async
  // function turns it into a rejection), so the turn remembers it overran.
  runtime.setInterruptHandler(() => {
    if (clock.currentTimeMillisUnsafe() > deadline) overran = true;
    return overran || core.over();
  });

  const post = context.newFunction("__kb_post", (handle) => {
    core.accept(context.typeof(handle) === "string" ? context.getString(handle) : "");
  });
  context.setProp(context.global, "__kb_post", post);
  post.dispose();

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    // A run cut off mid-turn can leave handles QuickJS still counts, and its
    // runtime then refuses to free itself. The instance is this run's alone,
    // so it is dropped either way.
    try {
      context.dispose();
      runtime.dispose();
    } catch {
      // the instance is garbage now
    }
  };

  /** One turn: `step`, then the promise jobs it queued, under one deadline. */
  const turn = (step: () => ReturnType<QuickJSContext["evalCode"]>) => {
    if (core.over() || disposed) return;
    deadline = clock.currentTimeMillisUnsafe() + spec.limits.turnMs;
    try {
      const result = step();
      if (result.error === undefined) {
        result.value.dispose();
        const jobs = runtime.executePendingJobs();
        if (jobs.error !== undefined) {
          const text = errorText(jobs.error.context, jobs.error);
          jobs.error.dispose();
          core.finish(endOfFailure(text, spec.limits));
        }
      } else {
        const text = errorText(context, result.error);
        result.error.dispose();
        core.finish(endOfFailure(text, spec.limits));
      }
    } catch (error) {
      // QuickJS itself gave up (it aborted): nothing in this instance can run again.
      core.finish(
        endOf("error", spec.limits, error instanceof Error ? error.message : String(error)),
      );
    } finally {
      deadline = Number.POSITIVE_INFINITY;
    }
    if (overran) core.finish(endOf("interrupted", spec.limits));
    if (core.over()) dispose();
  };

  const stop = Effect.sync(() => {
    core.finish(endOf("stopped", spec.limits));
    dispose();
  });
  yield* Effect.addFinalizer(() => stop);

  turn(() => context.evalCode(guestScript(spec.code, { subject: spec.subject }), "guest.js"));

  return {
    deliver: (message) =>
      Effect.sync(() =>
        turn(() => {
          const receive = context.getProp(context.global, "__kb_receive");
          const arg = context.newString(message);
          try {
            return context.callFunction(receive, context.undefined, arg);
          } finally {
            receive.dispose();
            arg.dispose();
          }
        }),
      ),
    outbox: core.outbox,
    ended: core.ended,
    over: core.over,
    stop,
  };
});

/** QuickJS-wasm: the engine for code nobody has trusted. */
export const quickjsEngine: SandboxEngine = { kind: "quickjs", start };
