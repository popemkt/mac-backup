/**
 * The step loop keeps the agent runtime contract over a step played in
 * memory: the model double is shown the conversation the loop hands a step,
 * and its moves come back as the step's events. Any adapter that supplies a
 * step over its wire inherits the loop's half of the contract.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import {
  AgentRuntimeError,
  agentRuntimeContract,
  stepRuntime,
  type ModelDouble,
  type Step,
  type StepEvent,
  type StepMessage,
} from "../src/index.ts";

/** The user messages and, since the last of them, the tool results and steps taken. */
function sightOf(messages: readonly StepMessage[]) {
  const last = messages.findLastIndex((message) => message.role === "user");
  const since = messages.slice(last + 1);
  return {
    users: messages.flatMap((message) => (message.role === "user" ? [message.text] : [])),
    results: since.flatMap((message) => (message.role === "tool" ? [message.text] : [])),
    step: since.filter((message) => message.role === "assistant").length + 1,
  };
}

/** A step whose model is `model`, played in memory. */
function modelStep(model: ModelDouble): Step {
  let calls = 0;
  return (messages, tools) => {
    const moves = model({ ...sightOf(messages), tools: tools.map((tool) => tool.name) });
    const failure = moves.find((move) => "fail" in move);
    if (failure !== undefined && "fail" in failure) {
      return Stream.fail(new AgentRuntimeError({ message: failure.fail }));
    }
    const stall = moves.find((move) => "stall" in move);
    const events = Stream.fromIterable(
      moves.flatMap((move): StepEvent[] => {
        if ("say" in move) return [{ kind: "text", delta: move.say }];
        if (!("call" in move)) return [];
        return [
          { kind: "call", call: { id: `call-${++calls}`, name: move.call, input: move.input } },
        ];
      }),
    );
    if (stall === undefined || !("stall" in stall)) return events;
    // A stalled step streams nothing more until it is interrupted.
    const thinking = Effect.sync(() => stall.stall.thinking()).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() => Effect.sync(() => stall.stall.cancelled())),
    );
    return Stream.concat(events, Stream.fromEffect(thinking));
  };
}

agentRuntimeContract(
  {
    name: "step loop",
    runtime: (model) => stepRuntime({ name: "in memory", step: modelStep(model) }),
  },
  { describe, test, same: (observed, expected) => expect(observed).toEqual(expected) },
);

describe("the step loop's own text", () => {
  test("text from a later step starts a new paragraph", async () => {
    const runtime = stepRuntime({
      name: "in memory",
      step: modelStep(({ step }) =>
        step === 1
          ? [{ say: "Looking." }, { call: "node_get", input: {} }]
          : [{ say: "Found it." }],
      ),
    });
    const outputs = await Effect.runPromise(
      Stream.runCollect(
        runtime.turn({
          system: "",
          message: { text: "find", screen: null },
          resume: undefined,
          tools: [],
          call: (action) => Effect.die(action),
        }),
      ),
    );
    const text = outputs.flatMap((output) => (output.kind === "text" ? [output.delta] : []));
    expect(text.join("")).toBe("Looking.\n\nFound it.");
  });
});
