/**
 * A script's call, decided against what its run may reach (DESIGN.md →
 * Sandbox → Grants): the grant its host stamped on the call, and the node
 * the run is for. The invoke core asks this for every call made as the
 * `script` actor, from either host — the page's frame and the server's
 * runs alike — so a script reaches through any action only what its
 * subject holds, as the action declares what a call acts on (`targets`).
 */
import { Option, Schema } from "effect";
import type { ActionDefinition, ActionInvocation, KbContext } from "@kb/contracts";
import { CodeGrant, callTargets, grantRefusal } from "@kb/sandbox";

const decodeGrant = Schema.decodeUnknownOption(CodeGrant);

/** Why a script may not make this call, with the grant it was decided by; null when it may, or when it is no script's. */
export function scriptRefusal(
  def: Pick<ActionDefinition, "targets">,
  invocation: ActionInvocation,
  input: unknown,
  ctx: KbContext,
): { readonly message: string; readonly details?: unknown } | null {
  if (invocation.actor !== "script") return null;
  const scope = invocation.script;
  if (scope === undefined) {
    return { message: "a script's call says what its run may reach, and this one says nothing" };
  }
  const grant = Option.getOrUndefined(decodeGrant(scope.grant));
  if (grant === undefined) return { message: "this script's call carries no grant kb can read" };
  const refusal = grantRefusal(
    grant,
    { subject: scope.subject, node: (id) => ctx.index.getNode(id) },
    invocation.id,
    input,
    callTargets(def.targets, input),
  );
  return refusal === null ? null : { message: refusal, details: { grant } };
}
