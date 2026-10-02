import { Effect, Stream } from "effect";
import type { ActionReceipt } from "@kb/contracts";
import {
  AgentRuntimeError,
  type AgentOutput,
  type AgentRuntime,
  type AgentTurn,
} from "./runtime.ts";

/**
 * A runtime that plays a script instead of running a model: the runtime the
 * bridge's tests and the surface contract run against, so they need no
 * login and no network. A script is a function of the turn, so a step can
 * depend on what the person wrote or on the tools the turn was given.
 */
export type ScriptStep =
  /** Stream this text. */
  | { readonly say: string }
  /** Call an action, then stream what `answer` makes of its receipt, if anything. */
  | {
      readonly call: string;
      readonly input?: unknown;
      readonly answer?: (receipt: ActionReceipt) => string;
    }
  /** End the turn with this failure. */
  | { readonly fail: string }
  /** Never finish: the turn runs until it is cancelled. */
  | { readonly hang: true };

export interface ScriptedRuntime extends AgentRuntime {
  /** Every turn the runtime was given, in order. */
  readonly turns: readonly AgentTurn[];
}

function play(turn: AgentTurn, step: ScriptStep): Stream.Stream<AgentOutput, AgentRuntimeError> {
  if ("say" in step) return Stream.make({ kind: "text", delta: step.say });
  if ("fail" in step) return Stream.fail(new AgentRuntimeError({ message: step.fail }));
  if ("hang" in step) return Stream.never;
  const { answer } = step;
  return Stream.fromEffect(turn.call(step.call, step.input ?? {})).pipe(
    Stream.flatMap((receipt) =>
      answer === undefined ? Stream.empty : Stream.make({ kind: "text", delta: answer(receipt) }),
    ),
  );
}

export function scriptedRuntime(
  script: (turn: AgentTurn) => readonly ScriptStep[],
): ScriptedRuntime {
  const turns: AgentTurn[] = [];
  return {
    name: "scripted",
    turns,
    turn: (turn) =>
      Stream.unwrap(
        Effect.sync(() => {
          const index = turns.push(turn);
          const session: AgentOutput = { kind: "session", resume: `scripted-${index}` };
          return Stream.concat(
            Stream.make(session),
            Stream.fromIterable(script(turn)).pipe(Stream.flatMap((step) => play(turn, step))),
          );
        }),
      ),
  };
}
