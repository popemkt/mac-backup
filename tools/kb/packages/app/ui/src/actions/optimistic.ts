import type { PlannedMutation } from "@/actions/plan";
import { toast } from "@kb/ui-sdk";
import { invoke, invokeLocal } from "@/session/runtime";
import { useGraphStore } from "@/stores/graph.store"; // GAP [[01M1RXMRB7AZB7DPFR6XBPBKQ9]]
import { pageEditor } from "@/stores/page-editor"; // GAP [[01M1RXMRB7AZB7DPFR6XBPBKQ9]]

/** The page's editor's state now: where a write lands the caret. */
const editor = () => pageEditor().getState();

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
  const skipRemote = opts?.skipRemote === true || useGraphStore.getState().loadSource !== "api";

  for (const action of plan.actions) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- plans are deliberately ordered (split and merge depend on prior writes)
    const receipt = await (skipRemote ? invokeLocal(action) : invoke(action.id, action.input));
    if (receipt.status === "failed") {
      toast(receipt.message);
      return { ok: false };
    }
  }

  if (plan.focusId !== undefined) {
    // Its row where the page is being edited: the editor resolves the instance.
    editor().activateNode(plan.focusId, plan.focusCursor ?? 0);
  }
  return { ok: true, focusId: plan.focusId, focusCursor: plan.focusCursor };
}
