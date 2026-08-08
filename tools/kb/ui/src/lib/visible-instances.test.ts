import { beforeEach, describe, expect, it } from "vitest";
import { fixtureGraph } from "@/fixtures/graph";
import { queryResultInstanceKey } from "@/lib/instance-key";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID } from "@/lib/types";
import type { WireNode } from "@kb/protocol";
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
      .hydrateFromWire(
        [...fixtureGraph.nodes, queryWire()],
        fixtureGraph.rev,
        "fixtures",
      );
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
    expect(fromQuery?.instanceKey).toBe(
      queryResultInstanceKey("n.q1", "n.root-a"),
    );
    const across = store.getNextVisibleInstance(fromQuery!.instanceKey);
    expect(across?.instanceKey).toBe(
      queryResultInstanceKey("n.q1", "n.root-b"),
    );
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
});
