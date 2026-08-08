import { postAction } from "@/api/action";
import type { PlannedMutation } from "@/actions/plan";
import { outlineInstanceKey } from "@/lib/instance-key";
import { toast } from "@/lib/toast";
import { cloneWireNodes } from "@/lib/tx";
import { useOutlineStore } from "@/stores/outline.store";

export type RunOptimisticResult = {
  ok: boolean;
  focusId?: string;
  focusCursor?: number;
};

/**
 * Apply a planned mutation optimistically, POST actions, revert + toast on failure.
 * Fixture / offline mode skips remote and keeps the local tx.
 */
export async function runOptimistic(
  plan: PlannedMutation,
  opts?: { skipRemote?: boolean },
): Promise<RunOptimisticResult> {
  const store = useOutlineStore.getState();
  const snapshot = cloneWireNodes(store.wireNodes);
  const rev = store.rev;
  const source = store.loadSource;

  store.applyTx(plan.upserts, plan.deletes);

  if (plan.focusId) {
    const next = useOutlineStore.getState();
    const key = outlineInstanceKey(plan.focusId, next.nodes);
    next.activateNode(plan.focusId, plan.focusCursor ?? 0, key);
  }

  const skip =
    opts?.skipRemote === true ||
    source === "fixtures" ||
    source === null;

  if (skip) {
    return {
      ok: true,
      focusId: plan.focusId,
      focusCursor: plan.focusCursor,
    };
  }

  try {
    for (const action of plan.actions) {
      const receipt = await postAction(action.id, action.input);
      if (receipt.status === "failed") {
        useOutlineStore.getState().restoreSnapshot(snapshot, rev);
        toast(receipt.message || `action failed: ${action.id}`);
        return { ok: false };
      }
    }
    return {
      ok: true,
      focusId: plan.focusId,
      focusCursor: plan.focusCursor,
    };
  } catch (err) {
    useOutlineStore.getState().restoreSnapshot(snapshot, rev);
    toast(err instanceof Error ? err.message : String(err));
    return { ok: false };
  }
}
