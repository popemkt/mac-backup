import type { Actor, ApprovalDecision } from "@kb/model";
import { requiresApproval, type ActionInvocation, type ActionMode } from "./actions.ts";

/**
 * Approval, as every surface reads it (DESIGN.md → Action registry →
 * Approval). The invoke core decides each call; what is here is what a
 * surface needs to project that decision: what its wire carries, who calls
 * through it, and whether it lists an action at all.
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
