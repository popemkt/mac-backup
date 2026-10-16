import { Effect, Stream } from "effect";
import {
  asObjectSchema,
  failed,
  mcpToolName,
  mcpToolResult,
  type ActionReceipt,
  type ManifestEntry,
} from "@kb/contracts";
import { userTurnText } from "./prompt.ts";
import {
  AgentRuntimeError,
  MAX_STEPS,
  type AgentOutput,
  type AgentRuntime,
  type AgentTurn,
} from "./runtime.ts";

/**
 * The tool loop, for an adapter whose wire runs one model step and leaves
 * the tools to its caller (Chat Completions; `DESIGN.md` → Agent packages).
 * A step is the adapter's: one request to its model over the conversation so
 * far, streaming text and the calls it asks for. Everything around it is
 * here, once: the turn's tools as the model sees them (the names and
 * schemas `kb mcp` publishes), each call through `turn.call` in order, the
 * receipt handed back as the tool's result, `MAX_STEPS`, and the history a
 * `resume` handle names.
 */

/** A call the model asked for in a step: the adapter's id for it, the tool's name, its input. */
export interface StepCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/** A tool as a step offers it: its `kb mcp` name, what it does, its input schema. */
export interface StepTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: { readonly type: "object" } & Record<string, unknown>;
}

/** The conversation as a step is handed it. */
export type StepMessage =
  | { readonly role: "system"; readonly text: string }
  | { readonly role: "user"; readonly text: string }
  | { readonly role: "assistant"; readonly text: string; readonly calls: readonly StepCall[] }
  | { readonly role: "tool"; readonly call: string; readonly text: string };

/** What a step streams: text as it arrives, and each call the model asks for. */
export type StepEvent =
  | { readonly kind: "text"; readonly delta: string }
  | { readonly kind: "call"; readonly call: StepCall };

/** One model step over the conversation, with these tools on offer. */
export type Step = (
  messages: readonly StepMessage[],
  tools: readonly StepTool[],
) => Stream.Stream<StepEvent, AgentRuntimeError>;

function stepTool(entry: ManifestEntry): StepTool {
  return {
    name: mcpToolName(entry.id),
    description: entry.description,
    parameters: asObjectSchema(entry.inputSchema),
  };
}

/** What the model is shown of a receipt: the text `kb mcp` answers a tool call with. */
function resultText(receipt: ActionReceipt): string {
  return mcpToolResult(receipt)
    .content.map((part) => part.text)
    .join("");
}

/** A turn's state as the loop moves through it. */
interface Running {
  readonly turn: AgentTurn;
  readonly tools: readonly StepTool[];
  readonly byName: ReadonlyMap<string, ManifestEntry>;
  /** The conversation so far, this turn's included, saved under `resume` as it grows. */
  messages: readonly StepMessage[];
  /** Whether the reply has text yet: a later step's text starts a new paragraph. */
  wrote: boolean;
  readonly save: (messages: readonly StepMessage[]) => void;
}

/** One call, as the bridge runs it; a name the turn does not offer is refused without a call. */
function callOf(running: Running, call: StepCall): Effect.Effect<ActionReceipt> {
  const entry = running.byName.get(call.name);
  return entry === undefined
    ? Effect.succeed(failed(call.name, "unknown_action", `unknown tool: ${call.name}`))
    : running.turn.call(entry.id, call.input);
}

/** Step `n` of the turn, and every step after it while the model keeps calling. */
function stepsFrom(
  running: Running,
  step: Step,
  n: number,
): Stream.Stream<AgentOutput, AgentRuntimeError> {
  if (n > MAX_STEPS) {
    return Stream.fail(
      new AgentRuntimeError({ message: `the model did not finish within ${MAX_STEPS} steps` }),
    );
  }
  const calls: StepCall[] = [];
  let text = "";
  let started = false;
  const said = step(
    [{ role: "system", text: running.turn.system }, ...running.messages],
    running.tools,
  ).pipe(
    Stream.flatMap((event): Stream.Stream<AgentOutput> => {
      if (event.kind === "call") {
        calls.push(event.call);
        return Stream.empty;
      }
      const lead = !started && running.wrote ? "\n\n" : "";
      started = true;
      text += event.delta;
      return Stream.make({ kind: "text", delta: `${lead}${event.delta}` });
    }),
  );
  const after = Stream.unwrap(
    Effect.gen(function* () {
      running.wrote ||= started;
      const answered: StepMessage[] = [{ role: "assistant", text, calls }];
      // Each in order, because a call that needs approval waits for the person.
      for (const call of calls) {
        const receipt = yield* callOf(running, call);
        answered.push({ role: "tool", call: call.id, text: resultText(receipt) });
      }
      running.messages = [...running.messages, ...answered];
      running.save(running.messages);
      return calls.length === 0 ? Stream.empty : stepsFrom(running, step, n + 1);
    }),
  );
  return Stream.concat(said, after);
}

/**
 * A runtime over `step`: the adapter's model, with the tool loop run here.
 * `resume` is a handle on a conversation this runtime holds in memory; a
 * handle it does not hold starts afresh. Each turn emits a new handle, which
 * names the conversation with that turn in it.
 */
export function stepRuntime(options: { readonly name: string; readonly step: Step }): AgentRuntime {
  const histories = new Map<string, readonly StepMessage[]>();
  return {
    name: options.name,
    turn: (turn) =>
      Stream.unwrap(
        Effect.sync(() => {
          const prior = turn.resume === undefined ? [] : (histories.get(turn.resume) ?? []);
          const resume = crypto.randomUUID();
          const running: Running = {
            turn,
            tools: turn.tools.map(stepTool),
            byName: new Map(turn.tools.map((entry) => [mcpToolName(entry.id), entry])),
            messages: [...prior, { role: "user", text: userTurnText(turn.message) }],
            wrote: false,
            save: (messages) => histories.set(resume, messages),
          };
          running.save(running.messages);
          const session: AgentOutput = { kind: "session", resume };
          return Stream.concat(Stream.make(session), stepsFrom(running, options.step, 1));
        }),
      ),
  };
}
