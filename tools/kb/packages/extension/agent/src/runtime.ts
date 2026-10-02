import { Schema, type Effect, type Stream } from "effect";
import type { ActionReceipt, ManifestEntry } from "@kb/contracts";

/**
 * The agent runtime: the port every agent backend is an adapter of (the
 * local Claude Agent SDK in `@kb/agent-claude`, a scripted fake in tests; an
 * ACP client or another provider would be a third). The bridge owns the
 * conversation, the tools, approval and the prompt; a runtime owns only how
 * one turn of a model runs. What the port promises is stated once, in
 * `DESIGN.md` → Agent packages.
 */

/** What the person wrote, and what their tab showed when they sent it. */
export interface AgentMessage {
  readonly text: string;
  /** The sender tab's screen, rendered for the model (`prompt.ts`); null when the sender is no tab. */
  readonly screen: string | null;
}

/** One turn, as the bridge hands it to a runtime. */
export interface AgentTurn {
  /** Who the agent is and what kb is: the system prompt. */
  readonly system: string;
  readonly message: AgentMessage;
  /**
   * The runtime's own handle on this conversation so far: the last
   * `session` it emitted, absent on the first turn. Opaque to the bridge.
   */
  readonly resume: string | undefined;
  /** The registry actions the agent may call, as the manifest lists them. */
  readonly tools: readonly ManifestEntry[];
  /**
   * Call one by its action id. The bridge runs it, asking the person first
   * where the action's mode requires approval, and answers the receipt. It
   * never fails: a call that cannot run is a failed receipt.
   */
  readonly call: (action: string, input: unknown) => Effect.Effect<ActionReceipt>;
}

/** What a turn says as it runs: text as it streams, and the handle that resumes it. */
export type AgentOutput =
  | { readonly kind: "text"; readonly delta: string }
  | { readonly kind: "session"; readonly resume: string };

/** A turn the backend could not run or finish: not logged in, no binary, a model error. */
export class AgentRuntimeError extends Schema.TaggedError<AgentRuntimeError>()(
  "Kb/AgentRuntimeError",
  { message: Schema.String },
) {}

export interface AgentRuntime {
  /** How the sidebar names the backend. */
  readonly name: string;
  /**
   * Run one turn. The stream ends when the turn does, and interrupting it
   * cancels the turn, including a tool call still waiting for the person.
   */
  readonly turn: (turn: AgentTurn) => Stream.Stream<AgentOutput, AgentRuntimeError>;
}
