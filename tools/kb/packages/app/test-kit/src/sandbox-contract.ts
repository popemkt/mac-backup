/**
 * The sandbox contract: what every engine promises (DESIGN.md → Sandbox →
 * Engines and The threat model), written once and run over each of them.
 * Each engine's test file calls {@link sandboxContract} with its engine, so a
 * guarantee QuickJS keeps and the Worker breaks goes red.
 *
 * The properties run through `runGuest`, the one driver every host uses, over
 * a capability host that answers like the invoke core: the guest sees the
 * same API from either engine, its calls reach the host as the script's and
 * no further than its grant, and every bound ends the run with a reason
 * while the host stays up. They hold for every run kb hosts — the code a
 * view runs for each bundled view that declares events (a code view's own
 * code, a canvas's scripts) — each hearing the events that view declares
 * (`ViewKey.events`) and no other.
 */
import { describe, expect, test } from "bun:test";
import { Duration, Effect, Option, Queue, Schema, type Cause } from "effect";
import { failed, succeeded, type ActionInvocation } from "@kb/contracts";
import type { KbNode } from "@kb/model";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import {
  answerToolCall,
  drawingToHtml,
  runGuest,
  type CapabilityHost,
  type CodeGrant,
  type GuestEnd,
  type GuestRun,
  type KbEvent,
  type SandboxEngine,
  type SandboxLimits,
} from "@kb/sandbox";

/** Tight bounds, so a property that waits for one to end a run ends quickly. */
const LIMITS: SandboxLimits = {
  turnMs: 300,
  memoryBytes: 16 * 1024 * 1024,
  stackBytes: 256 * 1024,
  messagesPerSecond: 50,
  maxMessageChars: 4096,
  maxPendingCalls: 4,
  maxResultChars: 4096,
  maxDrawNodes: 100,
};

/** An action that asks for a person, as an approval policy would make it. */
const ASKING_ACTION = "ext.gated.stamp";

function node(id: string, children: string[] = []): KbNode {
  return { id, text: `text of ${id}`, props: {}, children, createdAt: "", updatedAt: "" };
}

/** A node under the subject whose reads the host never answers. */
const SLOW = "slow";

const NODES = new Map(
  [node("subject", ["child", SLOW]), node("child"), node(SLOW), node("outside")].map((n) => [
    n.id,
    n,
  ]),
);

/** What a run did, as the host saw it. */
interface Observed {
  readonly guest: GuestRun;
  /** The next drawing, as HTML; fails after a few seconds. */
  readonly drawing: Effect.Effect<string, Cause.TimeoutError>;
  readonly ended: Effect.Effect<GuestEnd, Cause.TimeoutError>;
  readonly invocations: ActionInvocation[];
  readonly logs: string[];
  /** An event of a type the run hears, at `target`. */
  readonly heard: (target: string) => KbEvent;
}

const decodeIdInput = Schema.decodeUnknownOption(Schema.Struct({ id: Schema.String }));

/** The id a call names, when its input names one. */
function idOf(invocation: ActionInvocation): string | undefined {
  return Option.getOrUndefined(Option.map(decodeIdInput(invocation.input), (input) => input.id));
}

/** Answers like the invoke core: reads by id, one action that asks, every other write done. */
function capabilityHost(invocations: ActionInvocation[]): CapabilityHost {
  return {
    node: (id) => NODES.get(id),
    invoke: (invocation) => {
      if (idOf(invocation) === SLOW) return Effect.never;
      return Effect.sync(() => {
        invocations.push(invocation);
        if (invocation.id === "node.get") {
          const found = NODES.get(idOf(invocation) ?? "");
          return found === undefined
            ? failed(invocation.id, "not_found", "no such node")
            : succeeded(invocation.id, { node: found });
        }
        if (invocation.id === ASKING_ACTION && invocation.approved !== true) {
          return failed(invocation.id, "approval_required", "asks for a person");
        }
        return succeeded(invocation.id, { done: invocation.id });
      });
    },
  };
}

const GRANT: CodeGrant = { reads: "subject", actions: ["node.update", ASKING_ACTION] };

/** A run kb hosts: what it is, and the events it hears, its view's own. */
interface ContractRun {
  readonly name: string;
  readonly events: readonly string[];
}

/** Every run kb hosts, one per bundled view that declares events: each property holds for each. */
const RUNS: readonly ContractRun[] = BUNDLED_DECLARATIONS.flatMap((declaration) =>
  (declaration.views ?? [])
    .filter((view) => view.key.events.length > 0)
    .map((view) => ({ name: `code run for ${view.key.id}`, events: view.key.events })),
);

/** An event type no view declares. */
const UNHEARD = "contract.unheard";

/** The first event type `run` hears: what its properties hand it. */
const heardBy = (run: ContractRun): string => run.events[0] ?? UNHEARD;

const observe = Effect.fn("sandboxContract.observe")(function* (
  engine: SandboxEngine,
  run: ContractRun,
  code: string,
) {
  const drawings = yield* Queue.unbounded<string>();
  const invocations: ActionInvocation[] = [];
  const logs: string[] = [];
  const capability = capabilityHost(invocations);
  const guest = yield* runGuest(
    engine,
    { code, subject: "subject", events: run.events, limits: LIMITS },
    {
      draw: (drawing) => Effect.asVoid(Queue.offer(drawings, drawingToHtml(drawing.nodes))),
      log: (_level, text) => Effect.sync(() => logs.push(text)),
      callTool: (call) =>
        answerToolCall(capability, { grant: GRANT, subject: "subject" }, LIMITS, call),
    },
  );
  const observed: Observed = {
    guest,
    drawing: Queue.take(drawings).pipe(Effect.timeout(Duration.seconds(5))),
    ended: guest.ended.pipe(Effect.timeout(Duration.seconds(10))),
    invocations,
    logs,
    heard: (target) => ({ type: heardBy(run), target }),
  };
  return observed;
});

/**
 * One property: code to run — given the event type its run hears — and what
 * to check of the run, inside its scope.
 */
interface Property {
  readonly code: (heard: string) => string;
  readonly check: (observed: Observed) => Effect.Effect<void, Cause.TimeoutError>;
}

/** Wait for the first drawing, hand the guest an event it hears, and wait for the run to end. */
function endAfterEvent(o: Observed) {
  return Effect.gen(function* () {
    yield* o.drawing;
    yield* o.guest.event(o.heard("x"));
    return yield* o.ended;
  });
}

const PROPERTIES: readonly (readonly [string, Property])[] = [
  [
    "draws what the code draws, shown for its subject",
    {
      code: () => `kb.draw(["p", {}, "for ", kb.subject])`,
      check: (o) => Effect.map(o.drawing, (html) => expect(html).toBe("<p>for subject</p>")),
    },
  ],
  [
    "reads its subject through the host, as the script, never approved",
    {
      code: () => `const n = await kb.node(kb.subject, 1); kb.draw(n.text);`,
      check: (o) =>
        Effect.map(o.drawing, (html) => {
          expect(html).toBe("text of subject");
          expect(o.invocations).toEqual([
            { id: "node.get", input: { id: "subject", depth: 1 }, actor: "script" },
          ]);
        }),
    },
  ],
  [
    "cannot read outside its grant, and the call never reaches the invoke core",
    {
      code: () =>
        `try { await kb.node("outside"); kb.draw("read"); } catch (e) { kb.draw(e.code); }`,
      check: (o) =>
        Effect.map(o.drawing, (html) => {
          expect(html).toBe("forbidden");
          expect(o.invocations).toEqual([]);
        }),
    },
  ],
  [
    "a write that needs a person comes back approval_required, and the guest cannot approve it",
    {
      code: () => `try { await kb.invoke(${JSON.stringify(ASKING_ACTION)}, { approved: true }); kb.draw("ran"); }
             catch (e) { kb.draw(e.code); }`,
      check: (o) =>
        Effect.map(o.drawing, (html) => {
          expect(html).toBe("approval_required");
          expect(o.invocations[0]?.approved).toBeUndefined();
          expect(o.invocations[0]?.actor).toBe("script");
        }),
    },
  ],
  [
    "has no network, no timers and no raw pipe",
    {
      code: () => `kb.draw([typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof importScripts,
        typeof setTimeout, typeof postMessage, typeof __kb_post, typeof EventSource].join(","))`,
      check: (o) =>
        Effect.map(o.drawing, (html) => expect(html).toBe(Array(8).fill("undefined").join(","))),
    },
  ],
  [
    "an infinite loop is interrupted with a clear message",
    {
      code: () => "while (true) {}",
      check: (o) =>
        Effect.map(o.ended, (end) => {
          expect(end.reason).toBe("interrupted");
          expect(end.message).toContain(`${String(LIMITS.turnMs)} ms`);
        }),
    },
  ],
  [
    "a loop in an event handler is interrupted too",
    {
      code: (heard) => `kb.on("${heard}", () => { while (true) {} }); kb.draw("ready");`,
      check: (o) => Effect.map(endAfterEvent(o), (end) => expect(end.reason).toBe("interrupted")),
    },
  ],
  [
    "a memory bomb is stopped",
    {
      code: () => `let s = "x"; while (true) s += s + s;`,
      check: (o) =>
        Effect.map(o.ended, (end) =>
          expect(["out-of-memory", "error", "interrupted"]).toContain(end.reason),
        ),
    },
  ],
  [
    "a message flood is stopped",
    {
      code: () => `while (true) kb.log("x");`,
      check: (o) => Effect.map(o.ended, (end) => expect(end.reason).toBe("flood")),
    },
  ],
  [
    "an oversized message is stopped",
    {
      code: () => `kb.draw("x".repeat(${String(LIMITS.maxMessageChars + 1)}))`,
      check: (o) => Effect.map(o.ended, (end) => expect(end.reason).toBe("oversized")),
    },
  ],
  [
    "too many calls waiting at once is stopped",
    {
      code: () =>
        `for (let i = 0; i < ${String(LIMITS.maxPendingCalls + 2)}; i++) kb.node(${JSON.stringify(SLOW)});`,
      check: (o) => Effect.map(o.ended, (end) => expect(end.reason).toBe("flood")),
    },
  ],
  [
    "a thrown error ends the run with its message",
    {
      code: () => `throw new Error("boom")`,
      check: (o) =>
        Effect.map(o.ended, (end) => {
          expect(end.reason).toBe("error");
          expect(end.message).toContain("boom");
        }),
    },
  ],
  [
    "an error thrown later, in a handler, ends the run with its message",
    {
      code: (heard) =>
        `kb.on("${heard}", async () => { await kb.node(kb.subject); throw new TypeError("late"); }); kb.draw("ok");`,
      check: (o) => Effect.map(endAfterEvent(o), (end) => expect(end.message).toContain("late")),
    },
  ],
  [
    "an event of a type the run does not hear never reaches the code",
    {
      code: (heard) =>
        `kb.on("${UNHEARD}", () => kb.draw("unheard")); kb.on("${heard}", () => kb.draw("heard")); kb.draw("ready");`,
      check: (o) =>
        Effect.gen(function* () {
          yield* o.drawing;
          yield* o.guest.event({ type: UNHEARD, target: null });
          yield* o.guest.event(o.heard("button-1"));
          expect(yield* o.drawing).toBe("heard");
        }),
    },
  ],
  [
    "events reach the code's handlers",
    {
      code: (heard) =>
        `kb.on("${heard}", (e) => kb.draw(["p", {}, e.type, ":", e.target])); kb.draw("ready");`,
      check: (o) =>
        Effect.gen(function* () {
          yield* o.drawing;
          const event = o.heard("button-1");
          yield* o.guest.event(event);
          expect(yield* o.drawing).toBe(`<p>${event.type}:button-1</p>`);
        }),
    },
  ],
  [
    "logs what the code logs, and stopping ends the run as stopped",
    {
      code: () => `console.log("hello", { n: 1 }); kb.draw("ok");`,
      check: (o) =>
        Effect.gen(function* () {
          yield* o.drawing;
          yield* o.guest.stop;
          expect((yield* o.ended).reason).toBe("stopped");
          expect(o.logs).toEqual(['hello {"n":1}']);
        }),
    },
  ],
];

function holds(engine: SandboxEngine, run: ContractRun, property: Property): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(observe(engine, run, property.code(heardBy(run))), property.check),
    ),
  );
}

/**
 * Run every property over `engine`, for each run kb hosts, then once more
 * after a run that had to be cut off, so a stuck engine cannot pass by never
 * being asked again.
 */
export function sandboxContract(engine: SandboxEngine): void {
  test(`sandbox contract: ${engine.kind} has runs to hold`, () => {
    expect(RUNS.length).toBeGreaterThan(0);
  });
  for (const run of RUNS) {
    describe(`sandbox contract: ${engine.kind}, ${run.name}`, () => {
      for (const [title, property] of PROPERTIES) test(title, () => holds(engine, run, property));
      test("the host stays up after a run it had to cut off", () =>
        holds(engine, run, {
          code: () => "while (true) {}",
          check: (o) => Effect.asVoid(o.ended),
        }).then(() =>
          holds(engine, run, {
            code: () => `kb.draw("still here")`,
            check: (o) => Effect.map(o.drawing, (html) => expect(html).toBe("still here")),
          }),
        ));
    });
  }
}
