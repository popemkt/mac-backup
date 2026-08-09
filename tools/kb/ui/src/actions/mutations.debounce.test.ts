import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPostAction } from "@/api/action";
import { fixtureGraph } from "@/fixtures/graph";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import {
  __resetPendingContentForTests,
  mutations,
} from "@/actions/mutations";

const loadGraph = vi.fn();

vi.mock("@/api/graph", () => ({
  loadGraph: (...args: unknown[]) => loadGraph(...args),
}));

vi.mock("@/lib/toast", () => ({
  toast: vi.fn(),
}));

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
    loadGraph.mockReset();
    __resetPendingContentForTests();
  });

  afterEach(() => {
    __resetPendingContentForTests();
    vi.useRealTimers();
    setPostAction(null);
  });

  it("resync-first recovery re-applies concurrent pending edits", async () => {
    const originalA = useOutlineStore.getState().nodes.get("n.root-a")!.text;
    const originalB = useOutlineStore.getState().nodes.get("n.root-b")!.text;

    loadGraph.mockResolvedValue({
      snapshot: {
        rev: 2,
        nodes: structuredClone(fixtureGraph.nodes),
      },
      source: "api" as const,
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

    expect(loadGraph).toHaveBeenCalled();
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

    loadGraph.mockRejectedValue(new Error("offline"));
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
  });
});
