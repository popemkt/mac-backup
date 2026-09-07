import { afterEach, describe, expect, it, vi } from "vitest";
import { setPostAction } from "@/api/action";
import { fixtureGraph } from "@/api/fixture-graph";
import { planSplit } from "./plan";
import { runOptimistic } from "./optimistic";
import { waitForBrowserPushes } from "@/session/runtime";
import { useOutlineStore } from "@/stores/outline.store";

describe("local action plans", () => {
  afterEach(() => setPostAction(null));

  it("runs multi-action plans locally in order and queues the same invocations", async () => {
    useOutlineStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "api");
    const calls: unknown[] = [];
    setPostAction(async (invocation) => {
      calls.push(invocation);
      return { status: "succeeded", id: invocation.id, output: {} };
    });
    const plan = planSplit(fixtureGraph.nodes, "n.root-a", 4, "n.split", {
      expandedIds: new Set(),
    });

    expect((await runOptimistic(plan)).ok).toBe(true);
    expect(useOutlineStore.getState().index?.getNode("n.root-a")?.text).toBe("Ship");
    expect(useOutlineStore.getState().index?.getNode("n.split")?.text).toBe(" kb ui shell");
    await waitForBrowserPushes();
    expect(calls).toEqual(plan.actions);
  });

  it("fixture mode runs locally without pushing", async () => {
    useOutlineStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "fixtures");
    const post = vi.fn();
    setPostAction(post);
    const result = await runOptimistic({
      actions: [{ id: "node.update", input: { id: "n.root-a", text: "offline" } }],
    });
    expect(result.ok).toBe(true);
    expect(useOutlineStore.getState().index?.getNode("n.root-a")?.text).toBe("offline");
    expect(post).not.toHaveBeenCalled();
  });
});
