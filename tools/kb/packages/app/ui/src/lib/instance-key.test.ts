import { beforeEach, describe, expect, it } from "vitest";
import { fixtureGraph } from "@/api/fixture-graph";
import { childInstanceKey, outlineInstanceKey, queryResultInstanceKey } from "@/lib/instance-key";
import { useOutlineStore } from "@/stores/outline.store";
import { resetOutlineStore } from "@/test-support/outline-store";

function seed() {
  resetOutlineStore();
  useOutlineStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
}

describe("render-instance identity", () => {
  beforeEach(seed);

  it("builds distinct keys for outline vs query-result instances", () => {
    const nodes = useOutlineStore.getState().nodes;
    const treeKey = outlineInstanceKey("n.root-a", nodes);
    const refKey = queryResultInstanceKey("n.q1", "n.root-a");
    expect(treeKey).toBe("tree/n.root-a");
    expect(refKey).toBe("ref:query:n.q1/n.root-a");
    expect(treeKey).not.toBe(refKey);
    expect(childInstanceKey(treeKey, "n.child-a1")).toBe("tree/n.root-a/n.child-a1");
  });

  it("activate binds editing to one instance when the same nodeId appears twice", () => {
    const treeKey = "tree/n.root-a";
    const refKey = queryResultInstanceKey("n.q1", "n.root-a");

    useOutlineStore.getState().activateNode("n.root-a", 2, treeKey);
    let s = useOutlineStore.getState();
    expect(s.activeNodeId).toBe("n.root-a");
    expect(s.activeInstanceKey).toBe(treeKey);

    // Real-instance match
    expect(s.activeNodeId === "n.root-a" && s.activeInstanceKey === treeKey).toBe(true);
    // Referenced-instance must NOT match
    expect(s.activeNodeId === "n.root-a" && s.activeInstanceKey === refKey).toBe(false);

    useOutlineStore.getState().activateNode("n.root-a", 0, refKey);
    s = useOutlineStore.getState();
    expect(s.activeInstanceKey).toBe(refKey);
    expect(s.activeNodeId === "n.root-a" && s.activeInstanceKey === treeKey).toBe(false);
  });
});
