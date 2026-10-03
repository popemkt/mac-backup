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
 * while the host stays up.
 */
import { describe, expect, test } from "bun:test";
import { Duration, Effect, Option, Queue, Schema, type Cause } from "effect";
import { failed, succeeded, type ActionInvocation } from "@kb/contracts";
import type { KbNode } from "@kb/model";
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

const observe = Effect.fn("sandboxContract.observe")(function* (
  engine: SandboxEngine,
  code: string,
) {
  const drawings = yield* Queue.unbounded<string>();
  const invocations: ActionInvocation[] = [];
  const logs: string[] = [];
  const capability = capabilityHost(invocations);
  const guest = yield* runGuest(
    engine,
    { code, subject: "subject", limits: LIMITS },
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
  };
  return observed;
});

/** One property: code to run, and what to check of the run, inside its scope. */
interface Property {
  readonly code: string;
  readonly check: (observed: Observed) => Effect.Effect<void, Cause.TimeoutError>;
}

const click = (target: string): KbEvent => ({ type: "click", target });

/** Wait for the first drawing, hand the guest a click, and wait for the run to end. */
function endAfterClick(o: Observed) {
  return Effect.gen(function* () {
    yield* o.drawing;
    yield* o.guest.event(click("x"));
    return yield* o.ended;
  });
}

const PROPERTIES: readonly (readonly [string, Property])[] = [
  [
    "draws what the code draws, shown for its subject",
    {
      code: `kb.draw(["p", {}, "for ", kb.subject])`,
      check: (o) => Effect.map(o.drawing, (html) => expect(html).toBe("<p>for subject</p>")),
    },
  ],
  [
    "reads its subject through the host, as the script, never approved",
    {
      code: `const n = await kb.node(kb.subject, 1); kb.draw(n.text);`,
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
      code: `try { await kb.node("outside"); kb.draw("read"); } catch (e) { kb.draw(e.code); }`,
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
      code: `try { await kb.invoke(${JSON.stringify(ASKING_ACTION)}, { approved: true }); kb.draw("ran"); }
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
      code: `kb.draw([typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof importScripts,
        typeof setTimeout, typeof postMessage, typeof __kb_post, typeof EventSource].join(","))`,
      check: (o) =>
        Effect.map(o.drawing, (html) => expect(html).toBe(Array(8).fill("undefined").join(","))),
    },
  ],
  [
    "an infinite loop is interrupted with a clear message",
    {
      code: "while (true) {}",
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
      code: `kb.on("click", () => { while (true) {} }); kb.draw("ready");`,
      check: (o) => Effect.map(endAfterClick(o), (end) => expect(end.reason).toBe("interrupted")),
    },
  ],
  [
    "a memory bomb is stopped",
    {
      code: `let s = "x"; while (true) s += s + s;`,
      check: (o) =>
        Effect.map(o.ended, (end) =>
          expect(["out-of-memory", "error", "interrupted"]).toContain(end.reason),
        ),
    },
  ],
  [
    "a message flood is stopped",
    {
      code: `while (true) kb.log("x");`,
      check: (o) => Effect.map(o.ended, (end) => expect(end.reason).toBe("flood")),
    },
  ],
  [
    "an oversized message is stopped",
    {
      code: `kb.draw("x".repeat(${String(LIMITS.maxMessageChars + 1)}))`,
      check: (o) => Effect.map(o.ended, (end) => expect(end.reason).toBe("oversized")),
    },
  ],
  [
    "too many calls waiting at once is stopped",
    {
      code: `for (let i = 0; i < ${String(LIMITS.maxPendingCalls + 2)}; i++) kb.node(${JSON.stringify(SLOW)});`,
      check: (o) => Effect.map(o.ended, (end) => expect(end.reason).toBe("flood")),
    },
  ],
  [
    "a thrown error ends the run with its message",
    {
      code: `throw new Error("boom")`,
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
      code: `kb.on("click", async () => { await kb.node(kb.subject); throw new TypeError("late"); }); kb.draw("ok");`,
      check: (o) => Effect.map(endAfterClick(o), (end) => expect(end.message).toContain("late")),
    },
  ],
  [
    "events reach the code's handlers",
    {
      code: `kb.on("click", (e) => kb.draw(["p", {}, e.type, ":", e.target])); kb.draw("ready");`,
      check: (o) =>
        Effect.gen(function* () {
          yield* o.drawing;
          yield* o.guest.event(click("button-1"));
          expect(yield* o.drawing).toBe("<p>click:button-1</p>");
        }),
    },
  ],
  [
    "logs what the code logs, and stopping ends the run as stopped",
    {
      code: `console.log("hello", { n: 1 }); kb.draw("ok");`,
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

function holds(engine: SandboxEngine, property: Property): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(Effect.flatMap(observe(engine, property.code), property.check)),
  );
}

/**
 * Run every property over `engine`, then once more after a run that had to
 * be cut off, so a stuck engine cannot pass by never being asked again.
 */
export function sandboxContract(engine: SandboxEngine): void {
  describe(`sandbox contract: ${engine.kind}`, () => {
    for (const [title, property] of PROPERTIES) test(title, () => holds(engine, property));
    test("the host stays up after a run it had to cut off", () =>
      holds(engine, { code: "while (true) {}", check: (o) => Effect.asVoid(o.ended) }).then(() =>
        holds(engine, {
          code: `kb.draw("still here")`,
          check: (o) => Effect.map(o.drawing, (html) => expect(html).toBe("still here")),
        }),
      ));
  });
}
