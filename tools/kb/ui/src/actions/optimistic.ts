import { postAction } from "@/api/action";
import type { PlannedMutation } from "@/actions/plan";
import { fetchGraphSnapshot } from "@/api/graph";
import { outlineInstanceKey } from "@/lib/instance-key";
import { toast } from "@/lib/toast";
import { cloneWireNodes, mergeTx } from "@/lib/tx";
import type { WireNode } from "@kb/protocol";
import { useOutlineStore } from "@/stores/outline.store";

export type RunOptimisticResult = {
  ok: boolean;
  focusId?: string;
  focusCursor?: number;
};

/**
 * Local fallback when authoritative refetch fails after a plan error.
 * - Zero server applies: restore the pre-plan graph.
 * - Partial server applies: keep updates to pre-existing ids from the plan,
 *   drop minted ids (unconfirmed adds) so stale optimistic fragments vanish.
 * Never rewinds rev (restoreSnapshot enforces monotonic rev).
 */
function restoreAfterFailedPlan(
  plan: PlannedMutation,
  preNodes: WireNode[],
  serverApplied: number,
): void {
  const store = useOutlineStore.getState();
  // Pass current rev so restoreSnapshot can keep it monotonic.
  const revFloor = store.rev;

  if (serverApplied <= 0) {
    store.restoreSnapshot(preNodes, revFloor);
    return;
  }

  const preIds = new Set(preNodes.map((n) => n.id));
  const minted = plan.upserts
    .map((u) => u.id)
    .filter((id) => !preIds.has(id));
  const mintedSet = new Set(minted);
  const keptUpserts = plan.upserts
    .filter((u) => preIds.has(u.id))
    .map((u) => ({
      ...u,
      children: u.children.filter((c) => !mintedSet.has(c)),
    }));

  const next = mergeTx(cloneWireNodes(preNodes), keptUpserts, minted);
  // Preserve plan deletes only when every action succeeded — here we had a
  // failure, so do not apply deletes from the optimistic overlay.
  store.restoreSnapshot(next, revFloor);
}

async function recoverFailedPlan(
  plan: PlannedMutation,
  preNodes: WireNode[],
  serverApplied: number,
  message: string,
): Promise<void> {
  toast(message);
  try {
    const fresh = await fetchGraphSnapshot();
    useOutlineStore.getState().refreshFromWire(fresh.nodes, fresh.rev);
  } catch (err) {
    toast(
      `graph resync failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    restoreAfterFailedPlan(plan, preNodes, serverApplied);
  }
}

/**
 * Apply a planned mutation optimistically, POST actions, recover on failure.
 * Fixture / offline mode skips remote and keeps the local tx.
 *
 * On failure: strict refetch (never fixtures). Partial multi-action failure
 * must not rewind rev, must not leave stale minted nodes, and must not
 * clobber concurrent remote revisions once refetch succeeds.
 */
export async function runOptimistic(
  plan: PlannedMutation,
  opts?: { skipRemote?: boolean },
): Promise<RunOptimisticResult> {
  const store = useOutlineStore.getState();
  const snapshot = cloneWireNodes(store.wireNodes);
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

  let serverApplied = 0;
  try {
    for (const action of plan.actions) {
      const receipt = await postAction(action.id, action.input);
      if (receipt.status === "failed") {
        await recoverFailedPlan(
          plan,
          snapshot,
          serverApplied,
          receipt.message || `action failed: ${action.id}`,
        );
        return { ok: false };
      }
      serverApplied += 1;
    }
    return {
      ok: true,
      focusId: plan.focusId,
      focusCursor: plan.focusCursor,
    };
  } catch (err) {
    await recoverFailedPlan(
      plan,
      snapshot,
      serverApplied,
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false };
  }
}
