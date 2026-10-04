import type { PlannedMutation } from "@/actions/plan";
import { toast } from "@kb/ui-sdk";
import { invoke, invokeLocal } from "@/session/runtime";
import { useOutlineStore } from "@/stores/outline.store"; // GAP [[01M1RXMRB7AZB7DPFR6XBPBKQ9]]

export type RunOptimisticResult = {
  ok: boolean;
  focusId?: string;
  focusCursor?: number;
};

/** Run the canonical actions locally; the browser runtime owns ordered push. */
export async function runOptimistic(
  plan: PlannedMutation,
  opts?: { skipRemote?: boolean },
): Promise<RunOptimisticResult> {
  const skipRemote = opts?.skipRemote === true || useOutlineStore.getState().loadSource !== "api";

  for (const action of plan.actions) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- plans are deliberately ordered (split and merge depend on prior writes)
    const receipt = await (skipRemote ? invokeLocal(action) : invoke(action.id, action.input));
    if (receipt.status === "failed") {
      toast(receipt.message);
      return { ok: false };
    }
  }

  if (plan.focusId !== undefined) {
    // Its row in the outline being worked in: the store resolves the instance.
    useOutlineStore.getState().activateNode(plan.focusId, plan.focusCursor ?? 0);
  }
  return { ok: true, focusId: plan.focusId, focusCursor: plan.focusCursor };
}
