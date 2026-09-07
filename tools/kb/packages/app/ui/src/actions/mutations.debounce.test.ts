import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPostAction } from "@/api/action";
import { fixtureGraph } from "@/api/fixture-graph";
import { waitForBrowserPushes } from "@/session/runtime";
import { useOutlineStore } from "@/stores/outline.store";
import { __resetPendingContentForTests, mutations } from "./mutations";

describe("debounced text invocation", () => {
  const post = vi.fn(async (invocation) => ({
    status: "succeeded" as const,
    id: invocation.id,
    output: {},
  }));

  beforeEach(() => {
    vi.useFakeTimers();
    post.mockClear();
    setPostAction(post);
    __resetPendingContentForTests();
    useOutlineStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "api");
  });
  afterEach(() => {
    __resetPendingContentForTests();
    setPostAction(null);
    vi.useRealTimers();
  });

  it("updates the index before pushing only the coalesced text", async () => {
    await mutations.updateNodeContent("n.root-a", "one");
    await mutations.updateNodeContent("n.root-a", "two");
    expect(useOutlineStore.getState().index?.getNode("n.root-a")?.text).toBe("two");
    expect(post).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(280);
    await waitForBrowserPushes();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      id: "node.update",
      input: { id: "n.root-a", text: "two" },
    });
  });
});
