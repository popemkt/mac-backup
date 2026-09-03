import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPostAction } from "@/api/action";
import { setFetchGraphSnapshot } from "@/api/graph";
import { runOptimistic } from "@/actions/optimistic";
import {
  planMergeWithPrevious,
  planSplit,
  planUpdateText,
  type PlannedMutation,
} from "@/actions/plan";
import { fixtureGraph } from "@/fixtures/graph";
import { findParentWire } from "@/lib/tx";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";

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
    .hydrateFromWire(structuredClone(fixtureGraph.nodes), fixtureGraph.rev, source);
  useUiStore.setState({ toasts: [] });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("runOptimistic multi-action transactions", () => {
  const fetchGraph = vi.fn();

  beforeEach(() => {
    seed("api");
    setPostAction(null);
    fetchGraph.mockReset();
    setFetchGraphSnapshot(fetchGraph);
  });

  afterEach(() => {
    setPostAction(null);
    setFetchGraphSnapshot(null);
  });

  it("partial multi-action failure resyncs to authoritative server state", async () => {
    const split = planSplit(useOutlineStore.getState().wireNodes, "n.root-a", 4, "n.split-new", {
      expandedIds: new Set(),
    });
    expect(split.actions.length).toBe(2);

    const authoritative = structuredClone(fixtureGraph.nodes).map((n) =>
      n.id === "n.root-a" ? { ...n, text: "Ship" } : n,
    );
    // Server kept the successful update; add never landed.
    fetchGraph.mockResolvedValue({
      rev: 4,
      nodes: authoritative,
    });

    let calls = 0;
    setPostAction(async (inv) => {
      calls += 1;
      if (inv.id === "node.update") {
        return { status: "succeeded", id: inv.id, output: {} };
      }
      return {
        status: "failed",
        id: inv.id,
        code: "internal",
        message: "add failed",
      };
    });

    const result = await runOptimistic(split);
    expect(result.ok).toBe(false);
    expect(calls).toBe(2);
    expect(fetchGraph).toHaveBeenCalledTimes(1);

    const store = useOutlineStore.getState();
    expect(store.rev).toBe(4);
    expect(store.nodes.get("n.root-a")?.text).toBe("Ship");
    expect(store.nodes.has("n.split-new")).toBe(false);
    expect(store.loadSource).toBe("api");
    expect(useUiStore.getState().toasts.some((t) => t.text.includes("add failed"))).toBe(true);
  });

  it("does not rewind rev or clobber concurrent remote updates on failure", async () => {
    const beforeRev = useOutlineStore.getState().rev;
    // Interleaved remote revision lands while the plan is in flight.
    useOutlineStore.getState().applyTx(
      [
        {
          ...useOutlineStore.getState().wireNodes.find((n) => n.id === "n.root-c")!,
          text: "remote-concurrent",
        },
      ],
      [],
      { rev: beforeRev + 3 },
    );

    const plan: PlannedMutation = {
      upserts: [
        {
          ...useOutlineStore.getState().wireNodes.find((n) => n.id === "n.root-a")!,
          text: "optimistic-a",
        },
        {
          id: "n.ghost-add",
          text: "should not stick",
          props: {},
          children: [],
          createdAt: "2026-08-08T00:00:00.000Z",
          updatedAt: "2026-08-08T00:00:00.000Z",
        },
      ],
      deletes: [],
      actions: [
        {
          id: "node.update",
          input: { id: "n.root-a", text: "optimistic-a" },
        },
        {
          id: "node.add",
          input: { id: "n.ghost-add", text: "should not stick" },
        },
      ],
    };

    const serverNodes = structuredClone(useOutlineStore.getState().wireNodes)
      .filter((n) => n.id !== "n.ghost-add")
      .map((n) =>
        n.id === "n.root-a"
          ? { ...n, text: "server-kept-update" }
          : n.id === "n.root-c"
            ? { ...n, text: "remote-concurrent" }
            : n,
      );

    fetchGraph.mockResolvedValue({
      rev: beforeRev + 5,
      nodes: serverNodes,
    });

    setPostAction(async (inv) => {
      if (inv.id === "node.update") {
        return { status: "succeeded", id: inv.id, output: {} };
      }
      return {
        status: "failed",
        id: inv.id,
        code: "conflict",
        message: "second action failed",
      };
    });

    const result = await runOptimistic(plan);
    expect(result.ok).toBe(false);

    const store = useOutlineStore.getState();
    expect(store.rev).toBe(beforeRev + 5);
    expect(store.rev).toBeGreaterThan(beforeRev);
    expect(store.nodes.get("n.root-c")?.text).toBe("remote-concurrent");
    expect(store.nodes.get("n.root-a")?.text).toBe("server-kept-update");
    expect(store.nodes.has("n.ghost-add")).toBe(false);
  });

  it("resync failure after zero server applies restores local pre-plan without rev rewind", async () => {
    const before = useOutlineStore.getState().nodes.get("n.root-a")!.text;
    useOutlineStore.getState().applyTx([], [], { rev: 9 });
    expect(useOutlineStore.getState().rev).toBe(9);

    fetchGraph.mockRejectedValue(new Error("resync offline"));
    setPostAction(async () => ({
      status: "failed",
      id: "node.update",
      code: "internal",
      message: "boom",
    }));

    const plan = planUpdateText(useOutlineStore.getState().wireNodes, "n.root-a", "should bounce");
    const result = await runOptimistic(plan);
    expect(result.ok).toBe(false);
    expect(useOutlineStore.getState().nodes.get("n.root-a")?.text).toBe(before);
    expect(useOutlineStore.getState().rev).toBe(9);
    expect(useOutlineStore.getState().loadSource).toBe("api");
  });

  it("partial failure with failed resync keeps server-applied sibling, no rev rewind", async () => {
    useOutlineStore.getState().applyTx([], [], { rev: 7 });
    const split = planSplit(useOutlineStore.getState().wireNodes, "n.root-a", 4, "n.split-keep", {
      expandedIds: new Set(),
    });

    fetchGraph.mockRejectedValue(new Error("resync offline"));
    setPostAction(async (inv) => {
      if (inv.id === "node.update") {
        return { status: "succeeded", id: inv.id, output: {} };
      }
      return {
        status: "failed",
        id: inv.id,
        code: "internal",
        message: "add failed",
      };
    });

    const result = await runOptimistic(split);
    expect(result.ok).toBe(false);

    const store = useOutlineStore.getState();
    // Successful update half of the split remains locally (server kept it).
    expect(store.nodes.get("n.root-a")?.text).toBe("Ship");
    // Minted add from the failed action must not remain as a stale fragment.
    expect(store.nodes.has("n.split-keep")).toBe(false);
    expect(store.rev).toBeGreaterThanOrEqual(7);
    expect(store.loadSource).toBe("api");
  });

  it("retry after failed plan can succeed against live api source", async () => {
    fetchGraph.mockResolvedValue({
      rev: 2,
      nodes: structuredClone(fixtureGraph.nodes),
    });

    let attempt = 0;
    setPostAction(async () => {
      attempt += 1;
      if (attempt === 1) {
        return {
          status: "failed",
          id: "node.update",
          code: "internal",
          message: "transient",
        };
      }
      return { status: "succeeded", id: "node.update", output: {} };
    });

    const failPlan = planUpdateText(useOutlineStore.getState().wireNodes, "n.root-a", "first");
    expect((await runOptimistic(failPlan)).ok).toBe(false);
    expect(useOutlineStore.getState().loadSource).toBe("api");

    const okPlan = planUpdateText(useOutlineStore.getState().wireNodes, "n.root-a", "retry-ok");
    expect((await runOptimistic(okPlan)).ok).toBe(true);
    expect(useOutlineStore.getState().nodes.get("n.root-a")?.text).toBe("retry-ok");
    expect(attempt).toBe(2);
  });

  it("waits on deferred refetch before settling failure (no race)", async () => {
    const gate = deferred<{ rev: number; nodes: typeof fixtureGraph.nodes }>();
    fetchGraph.mockReturnValue(gate.promise);

    setPostAction(async () => ({
      status: "failed",
      id: "node.update",
      code: "internal",
      message: "boom",
    }));

    const plan = planUpdateText(useOutlineStore.getState().wireNodes, "n.root-a", "pending-resync");
    const pending = runOptimistic(plan);

    // Still optimistic until refetch resolves.
    expect(useOutlineStore.getState().nodes.get("n.root-a")?.text).toBe("pending-resync");

    gate.resolve({
      rev: 11,
      nodes: structuredClone(fixtureGraph.nodes),
    });
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(useOutlineStore.getState().rev).toBe(11);
    expect(useOutlineStore.getState().nodes.get("n.root-a")?.text).toBe(
      fixtureGraph.nodes.find((n) => n.id === "n.root-a")!.text,
    );
  });

  it("merge partial failure + failed refetch drops structural fragments, keeps text sibling", async () => {
    useOutlineStore.getState().applyTx([], [], { rev: 8 });
    const a1Before = useOutlineStore.getState().nodes.get("n.child-a1")!.text;
    const a2Before = useOutlineStore.getState().nodes.get("n.child-a2")!.text;
    const merge = planMergeWithPrevious(useOutlineStore.getState().wireNodes, "n.child-a2");
    expect(merge).not.toBeNull();
    expect(merge!.actions.length).toBeGreaterThan(2);
    expect(merge!.deletes).toEqual(["n.child-a2"]);

    fetchGraph.mockRejectedValue(new Error("resync offline"));
    let calls = 0;
    setPostAction(async () => {
      calls += 1;
      if (calls === 1) {
        return { status: "succeeded", id: "node.update", output: {} };
      }
      return {
        status: "failed",
        id: "node.update",
        code: "internal",
        message: "reparent failed",
      };
    });

    const result = await runOptimistic(merge!);
    expect(result.ok).toBe(false);

    const store = useOutlineStore.getState();
    const wire = store.wireNodes;
    // Confirmed text sibling kept; unconfirmed reparent/delete dropped.
    expect(store.nodes.get("n.child-a1")?.text).toBe(a1Before + a2Before);
    expect(store.nodes.get("n.child-a2")?.text).toBe(a2Before);
    expect(store.nodes.get("n.root-a")?.children).toEqual(["n.child-a1", "n.child-a2"]);
    expect(store.nodes.get("n.child-a2")?.children).toEqual(["n.grandchild"]);
    expect(store.nodes.get("n.child-a1")?.children ?? []).not.toContain("n.grandchild");
    expect(findParentWire(wire, "n.child-a2")?.id).toBe("n.root-a");
    expect(findParentWire(wire, "n.grandchild")?.id).toBe("n.child-a2");
    // No orphan forest-root / duplicated descendant.
    expect(findParentWire(wire, "n.child-a2")).not.toBeNull();
    expect(store.rev).toBeGreaterThanOrEqual(8);
    expect(store.loadSource).toBe("api");
  });

  it("merge partial failure + successful refetch adopts authoritative server state", async () => {
    const merge = planMergeWithPrevious(useOutlineStore.getState().wireNodes, "n.child-a2")!;
    const a1 = useOutlineStore.getState().wireNodes.find((n) => n.id === "n.child-a1")!;
    const a2 = useOutlineStore.getState().wireNodes.find((n) => n.id === "n.child-a2")!;
    // Server kept text update only — structure unchanged.
    const authoritative = structuredClone(fixtureGraph.nodes).map((n) =>
      n.id === "n.child-a1" ? { ...n, text: a1.text + a2.text } : n,
    );
    fetchGraph.mockResolvedValue({ rev: 12, nodes: authoritative });

    let calls = 0;
    setPostAction(async () => {
      calls += 1;
      if (calls === 1) {
        return { status: "succeeded", id: "node.update", output: {} };
      }
      return {
        status: "failed",
        id: "node.update",
        code: "internal",
        message: "reparent failed",
      };
    });

    expect((await runOptimistic(merge)).ok).toBe(false);
    const store = useOutlineStore.getState();
    expect(store.rev).toBe(12);
    expect(store.nodes.get("n.child-a1")?.text).toBe(a1.text + a2.text);
    expect(store.nodes.get("n.root-a")?.children).toEqual(["n.child-a1", "n.child-a2"]);
    expect(store.nodes.get("n.child-a2")?.children).toEqual(["n.grandchild"]);
    expect(fetchGraph).toHaveBeenCalledTimes(1);
  });

  it("merge double-failure preserves unrelated concurrent remote edits", async () => {
    const merge = planMergeWithPrevious(useOutlineStore.getState().wireNodes, "n.child-a2")!;
    // Interleaved remote update on an unrelated node during the plan.
    useOutlineStore.getState().applyTx(
      [
        {
          ...useOutlineStore.getState().wireNodes.find((n) => n.id === "n.root-b")!,
          text: "remote-unrelated",
        },
      ],
      [],
      { rev: 15 },
    );

    fetchGraph.mockRejectedValue(new Error("resync offline"));
    let calls = 0;
    setPostAction(async () => {
      calls += 1;
      if (calls === 1) {
        return { status: "succeeded", id: "node.update", output: {} };
      }
      return {
        status: "failed",
        id: "node.update",
        code: "internal",
        message: "reparent failed",
      };
    });

    expect((await runOptimistic(merge)).ok).toBe(false);
    const store = useOutlineStore.getState();
    expect(store.nodes.get("n.root-b")?.text).toBe("remote-unrelated");
    expect(store.rev).toBeGreaterThanOrEqual(15);
    expect(findParentWire(store.wireNodes, "n.grandchild")?.id).toBe("n.child-a2");
  });

  it("retry after merge double-failure can succeed", async () => {
    const merge = planMergeWithPrevious(useOutlineStore.getState().wireNodes, "n.child-a2")!;
    fetchGraph.mockRejectedValue(new Error("resync offline"));
    let calls = 0;
    setPostAction(async () => {
      calls += 1;
      if (calls <= 2) {
        // First plan: text ok, reparent fails (stops the plan).
        if (calls === 1) {
          return { status: "succeeded", id: "node.update", output: {} };
        }
        return {
          status: "failed",
          id: "node.update",
          code: "internal",
          message: "reparent failed",
        };
      }
      return { status: "succeeded", id: "node.update", output: {} };
    });

    expect((await runOptimistic(merge)).ok).toBe(false);
    expect(useOutlineStore.getState().loadSource).toBe("api");

    const retry = planMergeWithPrevious(useOutlineStore.getState().wireNodes, "n.child-a2")!;
    fetchGraph.mockReset();
    expect((await runOptimistic(retry)).ok).toBe(true);
    const store = useOutlineStore.getState();
    expect(store.nodes.has("n.child-a2")).toBe(false);
    expect(store.nodes.get("n.child-a1")?.children).toContain("n.grandchild");
  });
});
