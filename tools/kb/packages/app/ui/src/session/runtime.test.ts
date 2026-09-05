import { afterEach, describe, expect, it, vi } from "vitest";
import { setPostAction } from "@/api/action";
import { fixtureGraph } from "@/fixtures/graph";
import { DatascriptIndex } from "@kb/query";
import { invoke, invokeLocal, setBrowserReconciler, waitForBrowserPushes } from "@/session/runtime";
import { useOutlineStore } from "@/stores/outline.store";

describe("browser action runtime", () => {
  afterEach(() => {
    setPostAction(null);
    setBrowserReconciler(null);
  });

  it("changes the local index before the network push starts", async () => {
    useOutlineStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "api");
    const post = vi.fn(async (invocation) => ({
      status: "succeeded" as const,
      id: invocation.id,
      output: {},
    }));
    setPostAction(post);

    const invoked = invoke("node.update", { id: "n.root-a", text: "local first" });
    expect(post).not.toHaveBeenCalled();

    await invoked;
    expect(useOutlineStore.getState().index?.getNode("n.root-a")?.text).toBe("local first");
    await waitForBrowserPushes();
    expect(post).toHaveBeenCalledWith({
      id: "node.update",
      input: { id: "n.root-a", text: "local first" },
    });
  });

  it("keeps fifty local node updates incremental", async () => {
    useOutlineStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "fixtures");
    const index = useOutlineStore.getState().index;
    expect(index).toBeInstanceOf(DatascriptIndex);
    if (!(index instanceof DatascriptIndex)) throw new Error("expected a DatascriptIndex");
    const before = index.rebuilds;

    await Array.from({ length: 50 }, (_, i) => i).reduce(
      (tail, i) =>
        tail.then(async () => {
          const receipt = await invokeLocal({
            id: "node.update",
            input: { id: "n.root-a", text: `local ${i}` },
          });
          expect(receipt.status).toBe("succeeded");
          return undefined;
        }),
      Promise.resolve(),
    );

    expect(index.rebuilds).toBe(before);
  });

  it("an equal confirming echo converges without duplicating the node", async () => {
    useOutlineStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "fixtures");
    await invokeLocal({ id: "node.update", input: { id: "n.root-a", text: "confirmed" } });
    const local = useOutlineStore.getState().index?.getNode("n.root-a");
    expect(local?.text).toBe("confirmed");

    useOutlineStore.getState().applyTx(local ? [local] : [], [], { rev: 2 });
    const matches = useOutlineStore
      .getState()
      .index?.storedNodes()
      .filter((node) => node.id === "n.root-a");
    expect(matches).toHaveLength(1);
    expect(matches?.[0]).toEqual(local);
  });

  it("requests reconciliation when the remote confirmation fails", async () => {
    useOutlineStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 7, "api");
    const reconcile = vi.fn();
    setBrowserReconciler(reconcile);
    setPostAction(async (invocation) => ({
      status: "failed",
      id: invocation.id,
      code: "internal",
      message: "rejected",
    }));

    const receipt = await invoke("node.update", { id: "n.root-a", text: "optimistic" });
    expect(receipt.status).toBe("succeeded");
    await waitForBrowserPushes();
    expect(reconcile).toHaveBeenCalledOnce();
  });
});
