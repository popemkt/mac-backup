/**
 * The trusted engine (DESIGN.md → Sandbox → Engines): a dedicated Worker,
 * started from a blob that holds a bootstrap, the prelude and the guest's
 * code, so no script is fetched and nothing is evaluated from a string. It
 * runs at the platform's full speed and offers the same capability API as
 * QuickJS: the bootstrap takes the pipe's two ends for itself and then
 * removes from the guest's reach every API that connects, stores, schedules
 * or spawns. That removal is a courtesy to trusted code, not the boundary:
 * in the kb UI the Worker inherits the sandbox frame's CSP, which allows no
 * connection at all. A turn that outlives `turnMs` terminates the Worker; a
 * Worker's heap cannot be capped, so `memoryBytes` is not enforced here, and
 * a memory bomb ends as the runtime's own error or by the turn deadline.
 */
import { Clock, Effect, Option, Schema, type Scope } from "effect";
import {
  endOf,
  endOfFailure,
  guestScript,
  makeSessionCore,
  type GuestSession,
  type GuestSpec,
  type SandboxEngine,
} from "@kb/sandbox";

/** The globals the bootstrap takes out of the guest's reach. */
const REMOVED = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "WebSocketStream",
  "WebTransport",
  "EventSource",
  "importScripts",
  "Worker",
  "SharedWorker",
  "BroadcastChannel",
  "MessageChannel",
  "MessagePort",
  "indexedDB",
  "caches",
  "cookieStore",
  "navigator",
  "Request",
  "Response",
  "Headers",
  "WebAssembly",
  "crypto",
  "performance",
  "OffscreenCanvas",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "queueMicrotask",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "postMessage",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "onmessage",
  "onmessageerror",
  "close",
];

/**
 * The Worker's first script: it keeps `postMessage`, `addEventListener`
 * and `setTimeout` for the pipe, removes {@link REMOVED}, gives the prelude
 * `__kb_post`, hands each `in` message to `__kb_receive`, and says `idle`
 * once each turn and the jobs it queued are done.
 */
const BOOTSTRAP = String.raw`(function (removed) {
  "use strict";
  var scope = self;
  var send = scope.postMessage.bind(scope);
  var listen = scope.addEventListener.bind(scope);
  var later = scope.setTimeout.bind(scope);
  removed.forEach(function (name) {
    var target = scope;
    while (target) {
      var own = Object.getOwnPropertyDescriptor(target, name);
      if (own && own.configurable) { try { delete target[name]; } catch (e) {} }
      target = Object.getPrototypeOf(target);
    }
    try { Object.defineProperty(scope, name, { value: undefined, writable: false, configurable: false }); } catch (e) {}
  });
  var idle = function () { later(function () { send({ kb: "idle" }); }, 0); };
  scope.__kb_post = function (text) { send({ kb: "out", text: String(text) }); };
  listen("message", function (event) {
    var data = event.data;
    if (!data || data.kb !== "in") return;
    try { globalThis.__kb_receive(String(data.text)); } finally { idle(); }
  });
  idle();
})`;

/** What the bootstrap sends: a guest's message, or the end of a turn. */
const WorkerMessage = Schema.Union([
  Schema.Struct({ kb: Schema.Literal("out"), text: Schema.String }),
  Schema.Struct({ kb: Schema.Literal("idle") }),
]);
const decodeWorkerMessage = Schema.decodeUnknownOption(WorkerMessage);

/** How often the watchdog looks at a running turn. */
const WATCH_MS = 20;

const start = Effect.fn("sandbox.worker.start")(function* (
  spec: GuestSpec,
): Effect.fn.Return<GuestSession, never, Scope.Scope> {
  const core = yield* makeSessionCore(spec.limits);
  const clock = yield* Clock.Clock;
  const source = [
    `${BOOTSTRAP}(${JSON.stringify(REMOVED)});`,
    guestScript(spec.code, { subject: spec.subject }),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(url);
  // Turns waiting on the Worker, and when the oldest of them began.
  let waiting = 1;
  let since = clock.currentTimeMillisUnsafe();
  let terminated = false;
  const terminate = () => {
    if (terminated) return;
    terminated = true;
    worker.terminate();
    URL.revokeObjectURL(url);
  };

  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const message = Option.getOrUndefined(decodeWorkerMessage(event.data));
    if (message === undefined) return;
    if (message.kb === "out") {
      if (!core.accept(message.text)) terminate();
    } else if (waiting > 0) {
      waiting -= 1;
      since = clock.currentTimeMillisUnsafe();
    }
  });
  worker.addEventListener("error", (event: ErrorEvent) => {
    event.preventDefault();
    core.finish(endOfFailure(event.message || "the Worker failed", spec.limits));
    terminate();
  });

  const stop = Effect.sync(() => {
    core.finish(endOf("stopped", spec.limits));
    terminate();
  });
  yield* Effect.addFinalizer(() => stop);

  // The watchdog: a turn the Worker has not finished within its deadline ends the run.
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      while (!core.over()) {
        yield* Effect.sleep(WATCH_MS);
        if (waiting > 0 && clock.currentTimeMillisUnsafe() - since > spec.limits.turnMs) {
          core.finish(endOf("interrupted", spec.limits));
        }
      }
      terminate();
    }),
  );

  return {
    deliver: (message) =>
      Effect.sync(() => {
        if (core.over()) return;
        if (waiting === 0) since = clock.currentTimeMillisUnsafe();
        waiting += 1;
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no target origin
        worker.postMessage({ kb: "in", text: message });
      }),
    outbox: core.outbox,
    ended: core.ended,
    over: core.over,
    stop,
  };
});

/** A Worker: the engine for code a person has trusted on this machine. */
export const workerEngine: SandboxEngine = { kind: "worker", start };
