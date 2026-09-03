import { beforeEach, describe, expect, it } from "vitest";
import { fixtureGraph } from "@/fixtures/graph";
import { queryResultInstanceKey } from "@/lib/instance-key";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID } from "@/lib/types";
import type { WireNode } from "@kb/contracts";
import { useOutlineStore } from "@/stores/outline.store";

const TODO_EDN = `[:find ?id ?text
  :where [?n :f/${SYSTEM_IDS.typeField} ?t]
         [?t :node/id "tag.todo"]
         [?n :node/id ?id]
         [?n :node/text ?text]]`;

function queryWire(): WireNode {
  return {
    id: "n.q1",
    text: "Open todos",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.queryTag }],
      [SYSTEM_IDS.queryField]: [{ t: "str", v: TODO_EDN }],
    },
    children: [],
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

describe("visible instances", () => {
  beforeEach(() => {
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
      .hydrateFromWire([...fixtureGraph.nodes, queryWire()], fixtureGraph.rev, "fixtures");
  });

  it("includes query-result instances when the query node is expanded", () => {
    useOutlineStore.getState().toggleCollapse("n.q1");
    const keys = useOutlineStore
      .getState()
      .getVisibleInstances()
      .map((i) => i.instanceKey);
    expect(keys).toContain("tree/n.q1");
    expect(keys).toContain(queryResultInstanceKey("n.q1", "n.root-a"));
    expect(keys).toContain(queryResultInstanceKey("n.q1", "n.root-b"));
  });

  it("arrow neighbors move from tree into query results and across refs", () => {
    useOutlineStore.getState().toggleCollapse("n.q1");
    const store = useOutlineStore.getState();
    const fromQuery = store.getNextVisibleInstance("tree/n.q1");
    expect(fromQuery?.instanceKey).toBe(queryResultInstanceKey("n.q1", "n.root-a"));
    const across = store.getNextVisibleInstance(fromQuery!.instanceKey);
    expect(across?.instanceKey).toBe(queryResultInstanceKey("n.q1", "n.root-b"));
  });

  it("zoomed children use full-chain outline keys", () => {
    useOutlineStore.getState().zoomTo("n.root-a");
    useOutlineStore.getState().toggleCollapse("n.child-a2");
    const keys = useOutlineStore
      .getState()
      .getVisibleInstances()
      .map((i) => i.instanceKey);
    expect(keys).toEqual([
      "tree/n.root-a/n.child-a1",
      "tree/n.root-a/n.child-a2",
      "tree/n.root-a/n.child-a2/n.grandchild",
    ]);
  });

  it("table-mode frame emits only sorted direct children (no grandchildren)", async () => {
    const { mutations } = await import("@/actions/mutations");
    useOutlineStore.getState().zoomTo("n.root-a");
    useOutlineStore.getState().toggleCollapse("n.root-a");
    // Expand would show grandchild in list mode; table must stay flat.
    useOutlineStore.getState().toggleCollapse("n.child-a2");

    await mutations.setViewMode("n.root-a", "table");
    await mutations.setViewSort("n.root-a", [{ fieldId: "__name__", dir: "asc" }]);

    const keys = useOutlineStore
      .getState()
      .getVisibleInstances()
      .map((i) => i.instanceKey);

    // Sorted by name among n.root-a children (fixture texts), no grandchild.
    expect(keys).not.toContain("tree/n.root-a/n.child-a2/n.grandchild");
    expect(keys.every((k) => k.split("/").length === 3)).toBe(true);
    expect(keys).toContain("tree/n.root-a/n.child-a1");
    expect(keys).toContain("tree/n.root-a/n.child-a2");

    // Neighbor order follows sort projection, not children[] store order.
    const storeKids = useOutlineStore.getState().nodes.get("n.root-a")!.children;
    const sortedKeys = keys.filter((k) => storeKids.some((id) => k.endsWith(`/${id}`)));
    const texts = sortedKeys.map(
      (k) => useOutlineStore.getState().nodes.get(k.split("/").at(-1)!)?.text ?? "",
    );
    const sortedTexts = [...texts].sort((a, b) =>
      a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0,
    );
    expect(texts).toEqual(sortedTexts);
  });
});
