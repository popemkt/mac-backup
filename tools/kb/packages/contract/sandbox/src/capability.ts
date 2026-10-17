/**
 * The host side of the capability API (DESIGN.md → Sandbox → The capability
 * API): how a guest's tool call becomes a registry call. The host stamps the
 * call as the script's, with what its run may reach (its grant and its
 * subject), and the invoke core decides it: the grant first
 * (`grantRefusal`, against the nodes the action declares the call acts on),
 * then the approval policies, as for any other call. The guest's call
 * carries no envelope, so it never says who it is, what it may reach, or
 * approves itself: only its host can bring a person's answer to a call that
 * asks.
 */
import { Effect } from "effect";
import {
  failed,
  mcpToolResult,
  onWire,
  type ActionInvocation,
  type ActionReceipt,
  type SurfaceWire,
} from "@kb/contracts";
import type { CodeGrant } from "./grant.ts";
import type { SandboxLimits } from "./limits.ts";
import type { ToolCall, ToolResult } from "./protocol.ts";

/**
 * The sandbox's wire: every call is the script's. It carries approval only
 * as far as its host can put a person behind a call (the kb page asks them);
 * the guest's own calls never carry it.
 */
export const SCRIPT_WIRE: SurfaceWire = { carriesApproval: true, actor: "script" };

/** Where a run's calls go: the invoke core of the surface that hosts it. */
export interface CapabilityHost {
  /** Run one call through the invoke core and answer its receipt. */
  readonly invoke: (invocation: ActionInvocation) => Effect.Effect<ActionReceipt>;
}

/** What one run may reach: its grant, and the node it is shown for. */
export interface RunScope {
  readonly grant: CodeGrant;
  readonly subject: string | null;
}

/**
 * Answer one tool call of a run: the invoke core's receipt for it, made as
 * the script's within `scope`, as a tool result no longer than the run's
 * bound.
 */
export const answerToolCall = Effect.fn("sandbox.answerToolCall")(function* (
  host: CapabilityHost,
  scope: RunScope,
  limits: SandboxLimits,
  call: ToolCall,
): Effect.fn.Return<ToolResult> {
  const receipt = yield* host.invoke(
    onWire(SCRIPT_WIRE, {
      id: call.name,
      input: call.arguments ?? {},
      script: { subject: scope.subject, grant: scope.grant },
    }),
  );
  const result = mcpToolResult(receipt);
  const size = result.content.reduce((total, block) => total + block.text.length, 0);
  if (size <= limits.maxResultChars) return result;
  return mcpToolResult(
    failed(
      call.name,
      "invalid_input",
      `the result is ${String(size)} characters, more than the ${String(limits.maxResultChars)} a run may take; ask for less`,
    ),
  );
});
