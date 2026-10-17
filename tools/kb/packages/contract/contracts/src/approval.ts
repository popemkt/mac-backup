import { Context } from "effect";
import { z } from "zod";
import {
  APPROVAL_DECISIONS,
  configurationDecision,
  matchSpecificity,
  stricterDecision,
  writesApprovalPolicy,
  writesConfiguration,
  type Actor,
  type ApprovalDecision,
  type ApprovalPolicy,
  type NodeOf,
  type NodeWrite,
} from "@kb/model";
import {
  ManifestEntrySchema,
  requiresApproval,
  type ActionInvocation,
  type ActionMode,
  type ActionReceipt,
  type BatchPart,
} from "./actions.ts";

/**
 * Approval (DESIGN.md → Action registry → Approval): what is decided about a
 * call, by whom it is made, and what a surface needs to project the decision.
 * The invoke core decides each call with {@link resolveApproval}, the one
 * resolver; every surface reads the same decision to list its actions.
 */

/**
 * What a surface's wire format can carry, and who calls through it, declared
 * once by each surface that projects the registry (the CLI's `action-invoke`,
 * HTTP, MCP, WebMCP, the agent). The surface contract proves each declaration
 * by behaviour.
 */
export interface SurfaceWire {
  /** Whether a call on this wire has an envelope that can carry `approved`. */
  readonly carriesApproval: boolean;
  /**
   * Who a call on this wire is made by when the invocation does not say. A
   * wire with no envelope (MCP, WebMCP) can never say otherwise.
   */
  readonly actor: Actor;
}

/**
 * The invocation as it reaches the invoke core from `wire`: the actor it
 * declares, or else the wire's. Every surface hands the core its calls
 * through this, so no call arrives without the actor its surface stated.
 */
export function onWire(wire: SurfaceWire, invocation: ActionInvocation): ActionInvocation {
  return { ...invocation, actor: invocation.actor ?? wire.actor };
}

/** What an action's own mode decides about a call to it: `ask` where it requires approval. */
export function declaredDecision(mode: ActionMode): ApprovalDecision {
  return requiresApproval(mode) ? "ask" : "allow";
}

/**
 * One call, as the resolver weighs it: the action, who calls, and — once the
 * handler has worked it out, just before it commits — the nodes it writes.
 */
export interface ApprovalCall {
  readonly action: {
    readonly id: string;
    readonly mode: ActionMode;
    /** The actions it is a batch of, each with its own mode (`batchPartsOf`). */
    readonly batchOf?: readonly BatchPart[] | undefined;
  };
  readonly actor: Actor | undefined;
  readonly writes?: readonly NodeWrite[];
  /** How the writes' fields and kinds are read: the graph before the commit. */
  readonly nodeOf?: NodeOf;
}

/** What a governing write changes: the approval policies, or an extension's configuration. */
export type GoverningWrite = "approval-policy" | "configuration";

/** What is decided about one call, and what decided it. */
export interface ApprovalResolution {
  readonly decision: ApprovalDecision;
  /**
   * The policy that decided (its id), the action's declared mode (`mode`),
   * or the rule that a governing write is made only with a person behind
   * the call (`{writes}`): any write to a policy, and a write to
   * configuration by a caller acting for the owner.
   */
  readonly by: { readonly policy: string } | "mode" | { readonly writes: GoverningWrite };
}

/**
 * The one resolver: what is decided about a call.
 *
 * - A policy applies when its `match` names the action and its actor is the
 *   call's, or it names no actor. A call that names no actor (one made in
 *   process, never through a surface) meets only the policies for every actor.
 * - The most specific policy wins: by its match (the action's own id, then a
 *   pattern by its literal characters, then a mode word, then a bare `*`),
 *   then one naming the actor over one naming none, then the stricter
 *   decision, so two policies that tie never depend on their order.
 * - With none, the action's declared mode decides ({@link declaredDecision}).
 * - An action that declares itself a batch of others (`batchOf`) is decided
 *   as itself and as each of them, each with the mode its own definition
 *   declares, and the stricter decision holds; on a tie its own. A batch can never be allowed where
 *   one of the calls it makes would ask or be denied.
 * - A declared approval is a floor that only a policy naming the action by its
 *   own id can lower. Its author said every call needs a person; a pattern or
 *   a mode word written for many actions does not unsay it by accident, while
 *   a person who names the action means it.
 * - A governing write asks, whatever the policies say: a call that writes a
 *   policy, or the vocabulary policies are written in (otherwise a caller
 *   could allow itself), and a call that writes an extension's
 *   configuration (`writesConfiguration`: what the code runs with, such as
 *   the endpoint a key is sent to), as `configurationDecision` says for its
 *   actor: the owner's make it, an agent asks, sandboxed code is denied.
 *   That is known only from its writes, so the invoke core asks again with
 *   them just before the commit, and nothing is written when it refuses. A
 *   denial stays a denial.
 */
export function resolveApproval(
  policies: readonly ApprovalPolicy[],
  call: ApprovalCall,
): ApprovalResolution {
  const ruled = byPolicy(policies, call);
  if (ruled.decision === "deny") return ruled;
  const writes = call.writes ?? [];
  if (writes.some(writesApprovalPolicy)) {
    return { decision: "ask", by: { writes: "approval-policy" } };
  }
  const { nodeOf } = call;
  if (nodeOf === undefined || !writes.some((write) => writesConfiguration(write, nodeOf))) {
    return ruled;
  }
  const decision = configurationDecision(call.actor);
  return decision === "allow" ? ruled : { decision, by: { writes: "configuration" } };
}

function byPolicy(policies: readonly ApprovalPolicy[], call: ApprovalCall): ApprovalResolution {
  const { action, actor } = call;
  let decided = byPolicyAs(policies, action, actor);
  for (const part of action.batchOf ?? []) {
    const as = byPolicyAs(policies, part, actor);
    if (stricterDecision(as.decision, decided.decision) !== decided.decision) decided = as;
  }
  return decided;
}

/** What the policies decide about a call to `action` by `actor`, the action taken as it declares itself. */
function byPolicyAs(
  policies: readonly ApprovalPolicy[],
  action: { readonly id: string; readonly mode: ActionMode },
  actor: Actor | undefined,
): ApprovalResolution {
  const declared = declaredDecision(action.mode);
  let best: { policy: ApprovalPolicy; rank: readonly number[] } | null = null;
  for (const policy of policies) {
    if (policy.actor !== null && policy.actor !== actor) continue;
    const specificity = matchSpecificity(policy.match, action);
    if (specificity === null) continue;
    const rank = [...specificity, policy.actor === null ? 0 : 1];
    if (best === null || outranks(rank, policy, best)) best = { policy, rank };
  }
  if (best === null) return { decision: declared, by: "mode" };
  const exact = best.policy.match === action.id;
  return {
    decision: exact ? best.policy.decision : stricterDecision(best.policy.decision, declared),
    by: { policy: best.policy.id },
  };
}

function outranks(
  rank: readonly number[],
  policy: ApprovalPolicy,
  best: { policy: ApprovalPolicy; rank: readonly number[] },
): boolean {
  for (let i = 0; i < rank.length; i++) {
    const a = rank[i] ?? 0;
    const b = best.rank[i] ?? 0;
    if (a !== b) return a > b;
  }
  return stricterDecision(policy.decision, best.policy.decision) !== best.policy.decision;
}

/**
 * Whether a person stands behind the call: it says a person approved it, or
 * it is a person's own gesture. A human actor is the person, so a call that
 * asks is answered by the gesture itself; both are declared, not proven, and
 * whoever can claim one can claim the other.
 */
// GAP [[01M413SP3QSSQJMKKDK3W3J6G8]]
export function hasPerson(invocation: ActionInvocation): boolean {
  return invocation.approved === true || invocation.actor === "human";
}

/** Why a call may not run: the failure it is refused with. */
export interface ApprovalRefusal {
  readonly code: "forbidden" | "approval_required";
  readonly message: string;
  readonly details?: { readonly policy: string } | { readonly writes: GoverningWrite };
}

/**
 * What the invoke core refuses a call with, or `null` when it may run: a
 * denied call never runs, and a call that asks runs only with a person
 * behind it ({@link hasPerson}).
 */
export function approvalRefusal(
  resolution: ApprovalResolution,
  invocation: ActionInvocation,
): ApprovalRefusal | null {
  const { id } = invocation;
  const { decision, by } = resolution;
  if (decision === "allow" || (decision === "ask" && hasPerson(invocation))) return null;
  if (by === "mode") {
    return {
      code: "approval_required",
      message: `action ${id} requires approval; this call has none`,
    };
  }
  if ("writes" in by) {
    const caller = invocation.actor ?? "this caller";
    if (decision === "deny") {
      return {
        code: "forbidden",
        message: `action ${id} writes an extension's configuration, which a call by ${caller} never changes`,
        details: { writes: by.writes },
      };
    }
    const message =
      by.writes === "approval-policy"
        ? `action ${id} writes an approval policy, which always needs a person's approval; this call has none`
        : `action ${id} writes an extension's configuration, which a call by ${caller} makes only with the owner's approval; this call has none`;
    return { code: "approval_required", message, details: { writes: by.writes } };
  }
  if (decision === "deny") {
    return {
      code: "forbidden",
      message: `action ${id} is denied to ${invocation.actor ?? "this caller"} by approval policy ${by.policy}`,
      details: { policy: by.policy },
    };
  }
  return {
    code: "approval_required",
    message: `action ${id} asks for approval under policy ${by.policy}; this call has none`,
    details: { policy: by.policy },
  };
}

/**
 * Whether a surface lists an action, given what is decided about a call to
 * it on that surface. The one rule is this: a surface leaves out an action
 * whose call could never succeed there — one that is denied, or one that
 * asks for approval on a wire that cannot carry it. A call by id still
 * reaches the invoke core, which refuses it.
 */
export function listedOn(wire: SurfaceWire, decision: ApprovalDecision): boolean {
  if (decision === "deny") return false;
  return decision === "allow" || wire.carriesApproval;
}

/**
 * One action as `kb.manifest` lists it to a caller: its manifest entry and
 * what is decided about that caller's call to it.
 */
export const DecidedEntrySchema = ManifestEntrySchema.extend({
  decision: z.enum(APPROVAL_DECISIONS),
});
export type DecidedEntry = z.infer<typeof DecidedEntrySchema>;

const ManifestActionsSchema = z.object({ actions: z.array(DecidedEntrySchema) });

/**
 * What a surface lists, from the receipt of the `kb.manifest` call it made on
 * its own wire: the actions {@link listedOn} keeps. A surface that cannot read
 * the manifest (a policy denies it, say) lists nothing, since it cannot know
 * what else it could call.
 */
export function listingOf(wire: SurfaceWire, receipt: ActionReceipt): DecidedEntry[] {
  if (receipt.status !== "succeeded") return [];
  const parsed = ManifestActionsSchema.safeParse(receipt.output);
  if (!parsed.success) return [];
  return parsed.data.actions.filter((entry) => listedOn(wire, entry.decision));
}

/** The call a handler runs as: the invocation, and the action it invokes. */
export interface RunningCall {
  readonly invocation: ActionInvocation;
  readonly action: ApprovalCall["action"];
}

/**
 * The call a handler runs as. The invoke core provides it around each
 * handler, so an action that answers by its caller (`kb.manifest` lists what
 * is decided for that caller) reads it here rather than from its input, and
 * the commit asks the resolver again with what the call writes. Code that
 * runs outside any invocation sees `null`.
 */
export const CurrentCall = Context.Reference<RunningCall | null>("kb/CurrentCall", {
  defaultValue: () => null,
});
