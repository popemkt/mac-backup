import { resolveApproval, type ApprovalResolution, type KbContext } from "@kb/contracts";
import { approvalPoliciesOf, type Actor, type ApprovalPolicy } from "@kb/model";
import type { KbIndex } from "@kb/query";

/**
 * The policies a session holds, read once per index generation: every write
 * moves the generation, so a policy written a moment ago decides the next
 * call, and a run of calls between writes reads the graph once.
 */
const held = new WeakMap<KbIndex, { generation: number; policies: readonly ApprovalPolicy[] }>();

function policiesOf(ctx: KbContext): readonly ApprovalPolicy[] {
  const cached = held.get(ctx.index);
  if (cached?.generation === ctx.index.generation) return cached.policies;
  const policies = approvalPoliciesOf(ctx.index.allNodes());
  held.set(ctx.index, { generation: ctx.index.generation, policies });
  return policies;
}

/** What the session's policies decide about a call to `action` by `actor`. */
export function decide(
  ctx: KbContext,
  action: Parameters<typeof resolveApproval>[1],
  actor: Actor | undefined,
): ApprovalResolution {
  return resolveApproval(policiesOf(ctx), action, actor);
}
