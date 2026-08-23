import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPostAction } from "@/api/action";
import { setFetchGraphSnapshot } from "@/api/graph";
import { fixtureGraph } from "@/fixtures/graph";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import {
  __resetPendingContentForTests,
  mutations,
} from "@/actions/mutations";

vi.mock("@/lib/toast", () => ({
  toast: vi.fn(),
}));

const fetchGraphSnapshot = vi.fn();

function seed(source: "api" | "fixtures" = "api") {
  useOutlineStore.setState({
    nodes: new Map(),
    wireNodes: [],
    queryDb: null,
    rev: 0,
    rootNodeId: WORKSPACE_ROOT_ID,
    homeRootId: WORKSPACE_ROOT_ID,
    activeNodeId: null,
    activeInstanceKey: null,
    selectedNodeId: null,
    selectedInstanceKey: null,
    cursorPosition: 0,
    loadSource: null,
    loadError: null,
  });
  useOutlineStore
    .getState()
    .hydrateFromWire(
      structuredClone(fixtureGraph.nodes),
      fixtureGraph.rev,
      source,
    );
}

describe("debounced text-save rollback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seed("api");
    setPostAction(null);
    fetchGraphSnapshot.mockReset();
    setFetchGraphSnapshot(fetchGraphSnapshot);
    __resetPendingContentForTests();
  });

  afterEach(() => {
    __resetPendingContentForTests();
    vi.useRealTimers();
    setPostAction(null);
    setFetchGraphSnapshot(null);
  });

  it("resync-first recovery re-applies concurrent pending edits", async () => {
    const originalA = useOutlineStore.getState().nodes.get("n.root-a")!.text;
    const originalB = useOutlineStore.getState().nodes.get("n.root-b")!.text;

    fetchGraphSnapshot.mockResolvedValue({
      rev: 2,
      nodes: structuredClone(fixtureGraph.nodes),
    });

    setPostAction(async (inv) => {
      const input = inv.input as { id: string };
      if (input.id === "n.root-a") {
        return {
          status: "failed",
          id: "node.update",
          code: "internal",
          message: "save failed",
        };
      }
      return { status: "succeeded", id: "node.update", output: {} };
    });

    mutations.updateNodeContent("n.root-a", "failed-edit");
    await vi.advanceTimersByTimeAsync(200);
    // B starts later so A's debounce fires first while B stays pending.
    mutations.updateNodeContent("n.root-b", "concurrent-pending");

    expect(useOutlineStore.getState().nodes.get("n.root-a")?.text).toBe(
      "failed-edit",
    );
    expect(useOutlineStore.getState().nodes.get("n.root-b")?.text).toBe(
      "concurrent-pending",
    );

    await vi.advanceTimersByTimeAsync(80);

    expect(fetchGraphSnapshot).toHaveBeenCalled();
    expect(useOutlineStore.getState().nodes.get("n.root-a")?.text).toBe(
      originalA,
    );
    expect(useOutlineStore.getState().nodes.get("n.root-b")?.text).toBe(
      "concurrent-pending",
    );
    expect(useOutlineStore.getState().nodes.get("n.root-b")?.text).not.toBe(
      originalB,
    );
  });

  it("resync failure restores only the failed node, not the whole graph", async () => {
    const originalA = useOutlineStore.getState().nodes.get("n.root-a")!.text;
    const restoreSpy = vi.spyOn(
      useOutlineStore.getState(),
      "restoreSnapshot",
    );
    const hydrateSpy = vi.spyOn(useOutlineStore.getState(), "hydrateFromWire");
    hydrateSpy.mockClear();

    // Mutate another node successfully (simulates concurrent landed edit).
    useOutlineStore.getState().applyTx(
      [
        {
          ...useOutlineStore
            .getState()
            .wireNodes.find((n) => n.id === "n.root-c")!,
          text: "landed-elsewhere",
        },
      ],
      [],
    );

    fetchGraphSnapshot.mockRejectedValue(new Error("offline"));
    setPostAction(async (inv) => {
      const input = inv.input as { id: string };
      if (input.id === "n.root-a") {
        return {
          status: "failed",
          id: "node.update",
          code: "internal",
          message: "save failed",
        };
      }
      return { status: "succeeded", id: "node.update", output: {} };
    });

    mutations.updateNodeContent("n.root-a", "should-revert-locally");
    await vi.advanceTimersByTimeAsync(200);
    mutations.updateNodeContent("n.root-b", "still-pending");

    await vi.advanceTimersByTimeAsync(80);

    expect(restoreSpy).not.toHaveBeenCalled();
    expect(hydrateSpy).not.toHaveBeenCalled();
    expect(useOutlineStore.getState().loadSource).toBe("api");
    expect(useOutlineStore.getState().nodes.get("n.root-a")?.text).toBe(
      originalA,
    );
    expect(useOutlineStore.getState().nodes.get("n.root-b")?.text).toBe(
      "still-pending",
    );
    expect(useOutlineStore.getState().nodes.get("n.root-c")?.text).toBe(
      "landed-elsewhere",
    );

    restoreSpy.mockRestore();
    hydrateSpy.mockRestore();
  });

  it("re-applies a same-node re-edit typed during in-flight resync", async () => {
    const originalA = useOutlineStore.getState().nodes.get("n.root-a")!.text;
    let resolveResync!: (value: {
      rev: number;
      nodes: typeof fixtureGraph.nodes;
    }) => void;
    fetchGraphSnapshot.mockReturnValue(
      new Promise((resolve) => {
        resolveResync = resolve;
      }),
    );

    setPostAction(async (inv) => {
      const input = inv.input as { id: string };
      if (input.id === "n.root-a") {
        return {
          status: "failed",
          id: "node.update",
          code: "internal",
          message: "save failed",
        };
      }
      return { status: "succeeded", id: "node.update", output: {} };
    });

    mutations.updateNodeContent("n.root-a", "edit1");
    // Fire A's debounce → pendingContent.delete(A) → flush starts resync.
    await vi.advanceTimersByTimeAsync(280);
    expect(fetchGraphSnapshot).toHaveBeenCalled();

    // User types a newer edit while resync is still in flight.
    mutations.updateNodeContent("n.root-a", "edit2");
    expect(useOutlineStore.getState().nodes.get("n.root-a")?.text).toBe(
      "edit2",
    );

    resolveResync({
      rev: 2,
      nodes: structuredClone(fixtureGraph.nodes),
    });
    await vi.advanceTimersByTimeAsync(0);

    // Must keep the newer local edit — not the stale server original.
    expect(useOutlineStore.getState().nodes.get("n.root-a")?.text).toBe(
      "edit2",
    );
    expect(useOutlineStore.getState().nodes.get("n.root-a")?.text).not.toBe(
      originalA,
    );
  });

  it("skips a missing pending node without aborting sibling re-applies", async () => {
    const originalC = useOutlineStore.getState().nodes.get("n.root-c")!.text;
    const wireWithoutB = structuredClone(fixtureGraph.nodes).filter(
      (n) => n.id !== "n.root-b",
    );

    fetchGraphSnapshot.mockResolvedValue({
      rev: 3,
      nodes: wireWithoutB,
    });

    setPostAction(async (inv) => {
      const input = inv.input as { id: string };
      if (input.id === "n.root-a") {
        return {
          status: "failed",
          id: "node.update",
          code: "internal",
          message: "save failed",
        };
      }
      return { status: "succeeded", id: "node.update", output: {} };
    });

    mutations.updateNodeContent("n.root-a", "failed-edit");
    await vi.advanceTimersByTimeAsync(200);
    // B stays pending; C also pending — B will be absent from post-resync wire.
    mutations.updateNodeContent("n.root-b", "pending-deleted-server-side");
    mutations.updateNodeContent("n.root-c", "sibling-must-survive");

    // Must not reject / abort the batch when B is gone server-side.
    await vi.advanceTimersByTimeAsync(80);

    expect(fetchGraphSnapshot).toHaveBeenCalled();
    expect(useOutlineStore.getState().nodes.get("n.root-b")).toBeUndefined();
    expect(useOutlineStore.getState().nodes.get("n.root-c")?.text).toBe(
      "sibling-must-survive",
    );
    expect(useOutlineStore.getState().nodes.get("n.root-c")?.text).not.toBe(
      originalC,
    );
  });

  it("never swaps live api data for demo fixtures on resync failure", async () => {
    const hydrateSpy = vi.spyOn(useOutlineStore.getState(), "hydrateFromWire");
    hydrateSpy.mockClear();
    fetchGraphSnapshot.mockRejectedValue(new Error("graph down"));

    setPostAction(async () => ({
      status: "failed",
      id: "node.update",
      code: "internal",
      message: "save failed",
    }));

    mutations.updateNodeContent("n.root-a", "must-not-become-fixtures");
    await vi.advanceTimersByTimeAsync(280);

    expect(hydrateSpy).not.toHaveBeenCalled();
    expect(
      hydrateSpy.mock.calls.some((call) => call[2] === "fixtures"),
    ).toBe(false);
    expect(useOutlineStore.getState().loadSource).toBe("api");
    expect(
      useOutlineStore.getState().nodes.has("n.root-a"),
    ).toBe(true);

    hydrateSpy.mockRestore();
  });

  it("keeps later remote writes usable after a failed resync", async () => {
    fetchGraphSnapshot.mockRejectedValue(new Error("graph down"));
    const posts: unknown[] = [];
    setPostAction(async (inv) => {
      posts.push(inv);
      const input = inv.input as { id: string; text?: string };
      if (input.text === "first-fail") {
        return {
          status: "failed",
          id: "node.update",
          code: "internal",
          message: "save failed",
        };
      }
      return { status: "succeeded", id: "node.update", output: {} };
    });

    mutations.updateNodeContent("n.root-a", "first-fail");
    await vi.advanceTimersByTimeAsync(280);
    expect(useOutlineStore.getState().loadSource).toBe("api");

    mutations.updateNodeContent("n.root-a", "second-ok");
    await vi.advanceTimersByTimeAsync(280);

    expect(posts.length).toBe(2);
    expect(posts[1]).toMatchObject({
      id: "node.update",
      input: { id: "n.root-a", text: "second-ok" },
    });
    expect(useOutlineStore.getState().loadSource).toBe("api");
  });

  it("flushes the newest text before split so an old debounce cannot overwrite it (B13)", async () => {
    const posts: Array<{ id: string; input: Record<string, unknown> }> = [];
    setPostAction(async (inv) => {
      posts.push(inv as { id: string; input: Record<string, unknown> });
      return { status: "succeeded", id: inv.id, output: {} };
    });

    mutations.updateNodeContent("n.root-a", "abcdef");
    await mutations.splitNode("n.root-a", 3);
    await vi.advanceTimersByTimeAsync(300);

    const textPosts = posts.filter(
      (post) => post.id === "node.update" && post.input.id === "n.root-a",
    );
    expect(textPosts.map((post) => post.input.text)).toEqual(["abcdef", "abc"]);
    expect(textPosts.at(-1)?.input.text).toBe("abc");
  });

  it("cancels an unsent text write when its node is deleted (B14)", async () => {
    const posts: Array<{ id: string; input: Record<string, unknown> }> = [];
    setPostAction(async (inv) => {
      posts.push(inv as { id: string; input: Record<string, unknown> });
      return { status: "succeeded", id: inv.id, output: {} };
    });

    mutations.updateNodeContent("n.root-c", "fresh keystrokes");
    await mutations.deleteNode("n.root-c");
    await vi.advanceTimersByTimeAsync(300);

    expect(posts).toEqual([
      expect.objectContaining({
        id: "node.update",
        input: expect.objectContaining({ id: "n.root-c", delete: true }),
      }),
    ]);
  });
});
