import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { fixtureGraph } from "@/api/fixture-graph";
import { viewFieldNodes } from "@/fixtures/view-fields";
import {
  MAIN_OUTLINE_HOST,
  MAX_VIEW_DEPTH,
  queryResultInstanceKey,
  slotLink,
  syncUiPlugins,
  SYSTEM_IDS,
} from "@kb/ui-sdk";
import { setOutlineHost } from "@/stores/outline-hosts";
import type { WireNode } from "@kb/contracts";
import { useOutlineStore } from "@/stores/outline.store";
import { OutlineListView, OutlineTableView } from "@kb/views";
import { resetOutlineStore } from "@/test-support/outline-store";
import { outlineUiPlugin } from "@/components/outline/plugin";

// The outline runs as the app boots it: its frame views provided, and the
// store's row walk wired to them.
beforeAll(() => syncUiPlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

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
      [SYSTEM_IDS.queryField]: [{ t: "str", v: TODO_EDN }],
    },
    children: [],
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

describe("visible instances", () => {
  beforeEach(() => {
    resetOutlineStore();
    useOutlineStore
      .getState()
      .hydrateFromWire(
        [...fixtureGraph.nodes, ...viewFieldNodes, queryWire()],
        fixtureGraph.rev,
        "fixtures",
      );
  });

  afterEach(() => setOutlineHost(MAIN_OUTLINE_HOST, null));

  it("offers no row a slot would refuse to render: the one rule, over the same chain", () => {
    const store = useOutlineStore.getState();
    expect(store.getVisibleInstances().length).toBeGreaterThan(0);
    // The root frame's slot inside a slot already showing it: a cycle.
    setOutlineHost(MAIN_OUTLINE_HOST, {
      root: null,
      chain: [slotLink(OutlineListView, store.rootNodeId)],
    });
    expect(useOutlineStore.getState().getVisibleInstances()).toEqual([]);
    // The root frame's slot at the depth limit.
    setOutlineHost(MAIN_OUTLINE_HOST, {
      root: null,
      chain: Array.from({ length: MAX_VIEW_DEPTH }, (_, i) => `contract.view:${i}`),
    });
    expect(useOutlineStore.getState().getVisibleInstances()).toEqual([]);
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
    const fromQuery = present(store.getNextVisibleInstance("tree/n.q1"), "next from query");
    expect(fromQuery.instanceKey).toBe(queryResultInstanceKey("n.q1", "n.root-a"));
    const across = store.getNextVisibleInstance(fromQuery.instanceKey);
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

    await mutations.setFrameView("n.root-a", OutlineTableView);
    await mutations.setViewSort("n.root-a", [{ fieldId: SYSTEM_IDS.nodeTextField, dir: "asc" }]);

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
    const storeKids = present(
      useOutlineStore.getState().nodes.get("n.root-a"),
      "n.root-a",
    ).children;
    const sortedKeys = keys.filter((k) => storeKids.some((id) => k.endsWith(`/${id}`)));
    const texts = sortedKeys.map(
      (k) =>
        useOutlineStore.getState().nodes.get(present(k.split("/").at(-1), "instance id"))?.text ??
        "",
    );
    const sortedTexts = [...texts].toSorted((a, b) =>
      a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0,
    );
    expect(texts).toEqual(sortedTexts);
  });
});

describe("outlines in several panes", () => {
  beforeEach(() => {
    resetOutlineStore();
    useOutlineStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
  });
  afterEach(() => setOutlineHost("pane:p2", null));

  it("walks an outline open in another pane under that pane's host, apart from the main one", () => {
    setOutlineHost("pane:p2", { root: "n.root-a", chain: [] });
    const store = useOutlineStore.getState();
    const rows = store.getVisibleInstances("pane:p2");
    expect(rows.map((row) => row.instanceKey)).toContain("pane:p2/n.root-a/n.child-a1");
    expect(rows.every((row) => row.instanceKey.startsWith("pane:p2/"))).toBe(true);
    // The main outline's rows are its own: no row is in both walks.
    const main = new Set(store.getVisibleInstances().map((row) => row.instanceKey));
    expect(rows.some((row) => main.has(row.instanceKey))).toBe(false);
    // The keyboard stays inside the outline a row is drawn in.
    const [first, second] = rows;
    if (first === undefined || second === undefined) throw new Error("two rows");
    expect(store.getPreviousVisibleInstance(first.instanceKey)).toBeNull();
    expect(store.getNextVisibleInstance(first.instanceKey)).toEqual(second);
  });

  it("activates a row in the outline being worked in when no instance is named", () => {
    setOutlineHost("pane:p2", { root: "n.root-a", chain: [] });
    useOutlineStore.getState().selectNode("n.child-a1", "pane:p2/n.root-a/n.child-a1");
    useOutlineStore.getState().activateNode("n.child-a2");
    expect(useOutlineStore.getState().activeInstanceKey).toBe("pane:p2/n.root-a/n.child-a2");
  });
});
