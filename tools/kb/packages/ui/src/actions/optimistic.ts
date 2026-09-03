import { postAction } from "@/api/action";
import type { PlannedMutation } from "@/actions/plan";
import { fetchGraphSnapshot } from "@/api/graph";
import { outlineInstanceKey } from "@/lib/instance-key";
import type { PropValue } from "@/lib/types";
import { toast } from "@/lib/toast";
import { cloneWire, cloneWireNodes, mergeTx, nowIso } from "@/lib/tx";
import type { WireNode } from "@kb/contracts";
import { useOutlineStore } from "@/stores/outline.store";

export type RunOptimisticResult = {
  ok: boolean;
  focusId?: string;
  focusCursor?: number;
};

type ActionSpec = PlannedMutation["actions"][number];

/**
 * Structural mutations reshape the tree (reparent / reorder / delete / mint).
 * Their optimistic upserts must not be kept after a partial failure when
 * authoritative refetch is down — they bundle unconfirmed children[] edits.
 */
function isStructuralAction(action: ActionSpec): boolean {
  if (action.id === "node.add" || action.id === "field.define" || action.id === "tag.define") {
    return true;
  }
  if (action.id !== "node.update") return false;
  const input = action.input as Record<string, unknown>;
  return (
    input.delete === true ||
    Object.prototype.hasOwnProperty.call(input, "parent") ||
    Object.prototype.hasOwnProperty.call(input, "position")
  );
}

/** Apply a confirmed non-structural action onto a wire set (text/props only). */
function applySafeConfirmedAction(nodes: WireNode[], action: ActionSpec): WireNode[] | null {
  if (isStructuralAction(action)) return null;
  if (action.id !== "node.update") return null;

  const input = action.input as {
    id?: string;
    text?: string;
    setProps?: Array<{ field: string; value: PropValue }>;
    unsetProps?: Array<{ field: string; value?: unknown }>;
  };
  if (typeof input.id !== "string") return null;
  const existing = nodes.find((n) => n.id === input.id);
  if (!existing) return null;

  const next = cloneWire(existing);
  let changed = false;
  if (typeof input.text === "string") {
    next.text = input.text;
    changed = true;
  }
  if (input.unsetProps) {
    for (const u of input.unsetProps) {
      if (u.value !== undefined) {
        const list = next.props[u.field] ?? [];
        const filtered = list.filter((pv) => JSON.stringify(pv) !== JSON.stringify(u.value));
        if (filtered.length === 0) delete next.props[u.field];
        else next.props[u.field] = filtered;
      } else {
        delete next.props[u.field];
      }
      changed = true;
    }
  }
  if (input.setProps) {
    for (const s of input.setProps) {
      const list = next.props[s.field] ?? [];
      next.props[s.field] = [...list, s.value];
      changed = true;
    }
  }
  if (!changed) return null;
  next.updatedAt = nowIso();
  return mergeTx(nodes, [next], []);
}

function planTouchedIds(plan: PlannedMutation): Set<string> {
  const ids = new Set<string>();
  for (const u of plan.upserts) ids.add(u.id);
  for (const id of plan.deletes) ids.add(id);
  return ids;
}

/**
 * Local fallback when authoritative refetch fails after a plan error.
 * - Drop minted nodes and restore pre-plan payloads for every plan-touched id.
 * - Re-apply only confirmed *non-structural* actions (text/props).
 * - Leave unrelated current-graph nodes alone (concurrent remote edits).
 * Never rewinds rev (restoreSnapshot enforces monotonic rev).
 */
function restoreAfterFailedPlan(
  plan: PlannedMutation,
  preNodes: WireNode[],
  serverApplied: number,
): void {
  const store = useOutlineStore.getState();
  const revFloor = store.rev;
  const preById = new Map(preNodes.map((n) => [n.id, n]));
  const touched = planTouchedIds(plan);
  const minted = plan.upserts.map((u) => u.id).filter((id) => !preById.has(id));

  // Preserve unrelated nodes from the live graph (concurrent remote updates).
  let next = cloneWireNodes(store.wireNodes);
  next = mergeTx(next, [], minted);

  const restoreUpserts: WireNode[] = [];
  for (const id of touched) {
    if (minted.includes(id)) continue;
    const pre = preById.get(id);
    if (pre) restoreUpserts.push(cloneWire(pre));
  }
  next = mergeTx(next, restoreUpserts, []);

  for (let i = 0; i < serverApplied; i++) {
    const action = plan.actions[i];
    if (!action) break;
    const applied = applySafeConfirmedAction(next, action);
    if (applied) next = applied;
  }

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
    toast(`graph resync failed: ${err instanceof Error ? err.message : String(err)}`);
    restoreAfterFailedPlan(plan, preNodes, serverApplied);
  }
}

/**
 * Apply a planned mutation optimistically, POST actions, recover on failure.
 * Fixture / offline mode skips remote and keeps the local tx.
 *
 * On failure: strict refetch (never fixtures). Partial multi-action failure
 * must not rewind rev, must not leave stale minted/structural fragments, and
 * must not clobber concurrent remote revisions once refetch succeeds.
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

  const skip = opts?.skipRemote === true || source === "fixtures" || source === null;

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
