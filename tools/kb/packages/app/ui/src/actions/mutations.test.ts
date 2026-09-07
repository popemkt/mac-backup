import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPostAction } from "@/api/action";
import { fixtureGraph } from "@/api/fixture-graph";
import { mutations } from "./mutations";
import { waitForBrowserPushes } from "@/session/runtime";
import { useOutlineStore } from "@/stores/outline.store";

describe("mutations invoke shared actions", () => {
  const post = vi.fn(async (invocation) => ({
    status: "succeeded" as const,
    id: invocation.id,
    output: {},
  }));

  beforeEach(() => {
    post.mockClear();
    setPostAction(post);
    useOutlineStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "api");
  });

  it("indent sends one node.update and changes the local tree", async () => {
    await mutations.indentNode("n.child-a2");
    expect(useOutlineStore.getState().nodes.get("n.child-a1")?.children).toContain("n.child-a2");
    await waitForBrowserPushes();
    expect(post).toHaveBeenCalledWith({
      id: "node.update",
      input: { id: "n.child-a2", parent: "n.child-a1", position: 0 },
    });
  });

  it("property edits are applied through node.update", async () => {
    await mutations.updateProp("n.root-a", "sys.f.query", { t: "str", v: "[:find ?e]" });
    expect(useOutlineStore.getState().index?.getNode("n.root-a")?.props["sys.f.query"]).toEqual([
      { t: "str", v: "[:find ?e]" },
    ]);
  });
});
