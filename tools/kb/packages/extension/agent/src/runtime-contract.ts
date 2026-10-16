import { Cause, Deferred, Effect, Exit, Fiber, Stream } from "effect";
import { mcpToolName, succeeded, type ActionReceipt, type ManifestEntry } from "@kb/contracts";
import { AGENT_SYSTEM_PROMPT } from "./prompt.ts";
import {
  AgentRuntimeError,
  MAX_STEPS,
  type AgentOutput,
  type AgentRuntime,
  type AgentTurn,
} from "./runtime.ts";

/**
 * The agent runtime contract: what every adapter of the port promises
 * (`DESIGN.md` → Agent packages), written once and run over each of them
 * with a model double behind its own wire, so no network and no login is
 * needed. A promise one adapter keeps and another breaks goes red.
 *
 * The double is a model that plays moves: each step of a turn it is shown
 * what a model of that backend would have been shown (the tools by name,
 * the user messages, the tool results) and answers with text, tool calls
 * or a failure. An adapter's subject plays it over its wire: a fake `query`
 * yielding the SDK's messages for Claude, a fake `fetch` serving Chat
 * Completions for `openai-chat`, an in-memory step for the step loop.
 *
 * It is runner-agnostic so the port's own package can state it: a test file
 * hands it its runner's `describe`, `test` and a deep-equality check.
 */

/** What the model has been shown when it takes a step. */
export interface ModelSight {
  /** The tools it was offered, by the name the model calls them (`mcpToolName`). */
  readonly tools: readonly string[];
  /** Each user message of the conversation so far, oldest first; the last is this turn's. */
  readonly users: readonly string[];
  /** The text of each tool result this turn has handed it, in order. */
  readonly results: readonly string[];
  /** Which step of this turn it takes, from 1. */
  readonly step: number;
}

/** What the model does in a step, in order. A step that calls no tool ends the turn. */
export type ModelMove =
  | { readonly say: string }
  | { readonly call: string; readonly input: unknown }
  | { readonly fail: string };

/** A model: the moves it makes for each step, given what it has been shown. */
export type ModelDouble = (sight: ModelSight) => readonly ModelMove[];

/** An adapter under the contract: a runtime whose backend's model is `model`, played over its wire. */
export interface RuntimeSubject {
  readonly name: string;
  readonly runtime: (model: ModelDouble) => AgentRuntime;
}

/** The runner the contract is registered with, as a test file hands it over. */
export interface ContractRunner {
  readonly describe: (name: string, body: () => void) => void;
  readonly test: (name: string, body: () => Promise<void>) => void;
  /** Fail unless `observed` deeply equals `expected`. */
  readonly same: (observed: unknown, expected: unknown) => void;
}

const GET: ManifestEntry = {
  id: "node.get",
  title: "Get node",
  description: "Pull a node subtree",
  mode: { kind: "read" },
  inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  outputSchema: {},
};
const ADD: ManifestEntry = {
  id: "node.add",
  title: "Add node",
  description: "Add a node",
  mode: { kind: "write" },
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
  outputSchema: {},
};
const TOOLS = [GET, ADD];
const GET_TOOL = mcpToolName(GET.id);

/** What one turn did: what it said, every call it made, and what the model saw at each step. */
interface Played {
  readonly outputs: readonly AgentOutput[];
  readonly calls: readonly (readonly [string, unknown])[];
  readonly sights: readonly ModelSight[];
  readonly failure: string | null;
}

/** A model that records every sight, then answers by `play`. */
function recording(play: ModelDouble): {
  readonly model: ModelDouble;
  readonly sights: ModelSight[];
} {
  const sights: ModelSight[] = [];
  return {
    sights,
    model: (sight) => {
      sights.push(sight);
      return play(sight);
    },
  };
}

function turnOf(text: string, resume: string | undefined, call: AgentTurn["call"]): AgentTurn {
  return {
    system: AGENT_SYSTEM_PROMPT,
    message: { text, screen: null },
    resume,
    tools: TOOLS,
    call,
  };
}

/** Each call `call` was asked for, answered with `{ok: true}`. */
function answering(calls: (readonly [string, unknown])[]): AgentTurn["call"] {
  return (action, input) =>
    Effect.sync((): ActionReceipt => {
      calls.push([action, input]);
      return succeeded(action, { ok: true });
    });
}

const failureMessage = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.squash(cause);
  return error instanceof AgentRuntimeError ? `AgentRuntimeError: ${error.message}` : String(error);
};

/** Run one turn of `runtime` to its end, keeping everything it said. */
const playTurn = Effect.fnUntraced(function* (runtime: AgentRuntime, turn: AgentTurn) {
  const outputs: AgentOutput[] = [];
  const exit = yield* Effect.exit(
    Stream.runForEach(runtime.turn(turn), (output) => Effect.sync(() => outputs.push(output))),
  );
  return {
    outputs,
    failure: Exit.isSuccess(exit) ? null : failureMessage(exit.cause),
  };
});

const play = Effect.fnUntraced(function* (
  subject: RuntimeSubject,
  moves: ModelDouble,
): Effect.fn.Return<Played> {
  const { model, sights } = recording(moves);
  const calls: (readonly [string, unknown])[] = [];
  const played = yield* playTurn(
    subject.runtime(model),
    turnOf("hello", undefined, answering(calls)),
  );
  return { ...played, calls, sights };
});

const textOf = (outputs: readonly AgentOutput[]): string =>
  outputs.flatMap((output) => (output.kind === "text" ? [output.delta] : [])).join("");

const sessionsOf = (outputs: readonly AgentOutput[]): readonly string[] =>
  outputs.flatMap((output) => (output.kind === "session" ? [output.resume] : []));

/** One property: a name, and what it observed against what it expected. */
interface Property {
  readonly name: string;
  readonly check: (
    subject: RuntimeSubject,
  ) => Effect.Effect<{ readonly observed: unknown; readonly expected: unknown }>;
}

const PROPERTIES: readonly Property[] = [
  {
    name: "text arrives in order and concatenates, and the turn ends",
    check: (subject) =>
      Effect.map(
        play(subject, () => [{ say: "Hel" }, { say: "lo" }]),
        (played) => ({
          observed: { text: textOf(played.outputs), failure: played.failure },
          expected: { text: "Hello", failure: null },
        }),
      ),
  },
  {
    name: "a session is emitted",
    check: (subject) =>
      Effect.map(
        play(subject, () => [{ say: "hi" }]),
        (played) => ({
          observed: sessionsOf(played.outputs).length > 0,
          expected: true,
        }),
      ),
  },
  {
    name: "the model is offered exactly the turn's tools, by their kb mcp names",
    check: (subject) =>
      Effect.map(
        play(subject, () => [{ say: "hi" }]),
        (played) => ({
          observed: played.sights.map((sight) => sight.tools.toSorted()),
          expected: [TOOLS.map((entry) => mcpToolName(entry.id)).toSorted()],
        }),
      ),
  },
  {
    name: "a tool call reaches turn.call once, by action id with its input, and its receipt reaches the model",
    check: (subject) =>
      Effect.map(
        play(subject, ({ step }) =>
          step === 1 ? [{ call: GET_TOOL, input: { id: "n.a" } }] : [{ say: "done" }],
        ),
        (played) => ({
          observed: {
            calls: played.calls,
            shown: played.sights.map((sight) => sight.results.map((r) => r.includes('"ok":true'))),
            failure: played.failure,
          },
          expected: { calls: [["node.get", { id: "n.a" }]], shown: [[], [true]], failure: null },
        }),
      ),
  },
  {
    name: "a tool not in the turn's answers unknown_action to the model and is never invoked",
    check: (subject) =>
      Effect.map(
        play(subject, ({ step }) =>
          step === 1 ? [{ call: "kb_nope", input: {} }] : [{ say: "done" }],
        ),
        (played) => ({
          observed: {
            calls: played.calls,
            shown: played.sights.map((sight) => sight.results.map((r) => r.includes("unknown"))),
          },
          expected: { calls: [], shown: [[], [true]] },
        }),
      ),
  },
  {
    name: "a backend error becomes an AgentRuntimeError",
    check: (subject) =>
      Effect.map(
        play(subject, () => [{ fail: "the model fell over" }]),
        (played) => ({
          observed:
            played.failure?.startsWith("AgentRuntimeError: ") === true &&
            played.failure.includes("the model fell over"),
          expected: true,
        }),
      ),
  },
  {
    name: `a loop that never stops ends at MAX_STEPS (${MAX_STEPS}) with an AgentRuntimeError`,
    check: (subject) =>
      Effect.map(
        play(subject, () => [{ call: GET_TOOL, input: { id: "n.a" } }]),
        (played) => ({
          observed: {
            steps: played.sights.length,
            failed: played.failure?.startsWith("AgentRuntimeError: ") === true,
          },
          expected: { steps: MAX_STEPS, failed: true },
        }),
      ),
  },
  {
    name: "resume carries the conversation into the next turn",
    check: (subject) =>
      Effect.gen(function* () {
        const { model, sights } = recording(() => [{ say: "ok" }]);
        const runtime = subject.runtime(model);
        const first = yield* playTurn(runtime, turnOf("first", undefined, answering([])));
        const resume = sessionsOf(first.outputs).at(-1);
        yield* playTurn(runtime, turnOf("second", resume, answering([])));
        const users = sights.at(-1)?.users ?? [];
        return {
          observed: users.map((user) => [user.endsWith("first"), user.endsWith("second")]),
          expected: [
            [true, false],
            [false, true],
          ],
        };
      }),
  },
  {
    name: "interrupting the turn while a call waits interrupts the call and ends the stream",
    check: (subject) =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        let interrupted = false;
        const waiting: AgentTurn["call"] = () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted = true;
              }),
            ),
          );
        const runtime = subject.runtime(() => [{ call: GET_TOOL, input: { id: "n.a" } }]);
        const fiber = yield* Effect.forkChild(
          Stream.runDrain(runtime.turn(turnOf("wait", undefined, waiting))),
        );
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        return { observed: interrupted, expected: true };
      }),
  },
];

/** Register every property over `subject` with `runner`. */
export function agentRuntimeContract(subject: RuntimeSubject, runner: ContractRunner): void {
  runner.describe(`agent runtime contract: ${subject.name}`, () => {
    for (const property of PROPERTIES) {
      runner.test(property.name, () =>
        Effect.runPromise(
          Effect.map(property.check(subject), ({ observed, expected }) =>
            runner.same(observed, expected),
          ),
        ),
      );
    }
  });
}
