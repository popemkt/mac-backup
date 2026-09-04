import { beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { fixtureGraph } from "@/fixtures/graph";
import { outlineInstanceKey } from "@/lib/instance-key";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "./outline.store";

function seed() {
  useOutlineStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
}

const wire = (id: string, text: string) => ({
  id,
  text,
  props: {},
  children: [],
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-08T00:00:00.000Z",
});

describe("outline store (WireNode adaptation)", () => {
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
      loadSource: null,
      loadError: null,
    });
  });

  it("hydrates forest roots under virtual workspace root (id-sorted)", () => {
    seed();
    const root = present(useOutlineStore.getState().nodes.get(WORKSPACE_ROOT_ID), "workspace root");
    expect(root.children).toEqual(["lens.all-mentions", "n.root-a", "n.root-b", "n.root-c"]);
    expect(root.children).not.toContain("sys.tag");
    expect(root.children).not.toContain("tag.todo");
  });

  it("preserves ordered children arrays (no fractional order)", () => {
    seed();
    const a = present(useOutlineStore.getState().nodes.get("n.root-a"), "n.root-a");
    expect(a.children).toEqual(["n.child-a1", "n.child-a2"]);
    expect(a).not.toHaveProperty("order");
  });

  it("resolves tags from sys.f.type refs", () => {
    seed();
    const a = present(useOutlineStore.getState().nodes.get("n.root-a"), "n.root-a");
    expect(a.tags).toEqual([{ id: "tag.todo", name: "todo", color: expect.any(String) }]);
  });

  it("activate / select / deactivate", () => {
    seed();
    useOutlineStore.getState().activateNode("n.root-a", 3);
    expect(useOutlineStore.getState().activeNodeId).toBe("n.root-a");
    expect(useOutlineStore.getState().pendingCaret).toMatchObject({ at: 3 });
    useOutlineStore.getState().selectNode("n.root-b");
    expect(useOutlineStore.getState().selectedNodeId).toBe("n.root-b");
    expect(useOutlineStore.getState().activeNodeId).toBeNull();
    useOutlineStore.getState().deactivateNode();
    expect(useOutlineStore.getState().activeNodeId).toBeNull();
  });

  it("FocusRegistry reveals ancestors before activating a hidden child", () => {
    seed();
    useOutlineStore.getState().activateNode("n.grandchild", 0);
    const state = useOutlineStore.getState();
    expect(state.getVisibleNodes()).toContain("n.grandchild");
    expect(state.activeNodeId).toBe("n.grandchild");
    expect(state.pendingCaret).toMatchObject({ at: 0 });
  });

  it("FocusRegistry refuses a target outside the current visible root", () => {
    seed();
    useOutlineStore.getState().zoomTo("n.root-b");
    useOutlineStore.getState().activateNode("n.child-a1", 0);
    expect(useOutlineStore.getState().activeNodeId).toBeNull();
    expect(useOutlineStore.getState().pendingCaret).toBeNull();
  });

  it("defaults expandable nodes collapsed; visible list shows roots only", () => {
    seed();
    expect(useOutlineStore.getState().nodes.get("n.root-a")?.collapsed).toBe(true);
    expect(useOutlineStore.getState().getVisibleNodes()).toEqual([
      "lens.all-mentions",
      "n.root-a",
      "n.root-b",
      "n.root-c",
    ]);
  });

  it("toggleCollapse expands to show direct children (nested stay collapsed)", () => {
    seed();
    useOutlineStore.getState().toggleCollapse("n.root-a");
    expect(useOutlineStore.getState().getVisibleNodes()).toEqual([
      "lens.all-mentions",
      "n.root-a",
      "n.child-a1",
      "n.child-a2",
      "n.root-b",
      "n.root-c",
    ]);
    useOutlineStore.getState().toggleCollapse("n.root-a");
    expect(useOutlineStore.getState().getVisibleNodes()).toEqual([
      "lens.all-mentions",
      "n.root-a",
      "n.root-b",
      "n.root-c",
    ]);
  });

  it("defaults field-only expandable nodes collapsed", () => {
    seed();
    expect(useOutlineStore.getState().nodes.get("n.root-b")?.collapsed).toBe(true);
  });

  it("toggleCollapse expands field-only nodes", () => {
    seed();
    useOutlineStore.getState().toggleCollapse("n.root-b");
    expect(useOutlineStore.getState().nodes.get("n.root-b")?.collapsed).toBe(false);
  });

  it("does nothing when toggling a leaf without fields or children", () => {
    seed();
    useOutlineStore.getState().toggleCollapse("n.root-c");
    expect(useOutlineStore.getState().nodes.get("n.root-c")?.collapsed).toBe(false);
  });

  it("expandAllInScope expands every expandable node in the forest", () => {
    seed();
    useOutlineStore.getState().expandAllInScope();
    const s = useOutlineStore.getState();
    expect(s.nodes.get("n.root-a")?.collapsed).toBe(false);
    expect(s.nodes.get("n.root-b")?.collapsed).toBe(false);
    expect(s.nodes.get("n.child-a2")?.collapsed).toBe(false);
  });

  it("collapseAllInScope collapses expandable nodes in the current scope", () => {
    seed();
    useOutlineStore.getState().expandAllInScope();
    useOutlineStore.getState().collapseAllInScope();
    const s = useOutlineStore.getState();
    expect(s.nodes.get("n.root-a")?.collapsed).toBe(true);
    expect(s.nodes.get("n.root-b")?.collapsed).toBe(true);
  });

  it("expand/collapse all respects zoomed subtree scope", () => {
    seed();
    useOutlineStore.getState().zoomTo("n.root-a");
    useOutlineStore.getState().expandAllInScope();
    const s = useOutlineStore.getState();
    expect(s.nodes.get("n.root-a")?.collapsed).toBe(true);
    expect(s.nodes.get("n.child-a1")?.collapsed).toBe(false);
    expect(s.nodes.get("n.root-b")?.collapsed).toBe(true);
  });

  it("zoomTo changes root and breadcrumbs", () => {
    seed();
    useOutlineStore.getState().zoomTo("n.root-a");
    expect(useOutlineStore.getState().rootNodeId).toBe("n.root-a");
    expect(useOutlineStore.getState().getBreadcrumbs()).toEqual([
      { id: "n.root-a", text: "Ship kb ui shell" },
    ]);
    useOutlineStore.getState().zoomHome();
    expect(useOutlineStore.getState().rootNodeId).toBe(WORKSPACE_ROOT_ID);
  });

  it("search finds by text substring", () => {
    seed();
    const hits = useOutlineStore.getState().search("localStorage");
    expect(hits.map((h) => h.id)).toEqual(["n.grandchild"]);
  });

  it("getPrevious / getNext respect collapsed subtrees", () => {
    seed();
    useOutlineStore.getState().toggleCollapse("n.root-a");
    const s = useOutlineStore.getState();
    const aKey = outlineInstanceKey("n.root-a", s.nodes);
    const bKey = outlineInstanceKey("n.root-b", s.nodes);
    expect(present(s.getNextVisibleInstance(aKey), "next of n.root-a").nodeId).toBe("n.child-a1");
    expect(present(s.getPreviousVisibleInstance(bKey), "prev of n.root-b").nodeId).toBe(
      "n.child-a2",
    );
  });

  it("builds a DataScript query db on hydrate", () => {
    seed();
    const db = useOutlineStore.getState().queryDb;
    const qdb = present(db, "query db");
    expect(qdb.ids.toEid.has("n.root-a")).toBe(true);
    expect(qdb.rev).toBe(1);
  });

  describe("applyTx (WS delta seam)", () => {
    it("upserts new nodes and bumps rev + query db", () => {
      seed();
      useOutlineStore.getState().applyTx([wire("n.new", "fresh node")], [], { rev: 2 });
      const s = useOutlineStore.getState();
      expect(s.rev).toBe(2);
      expect(s.nodes.get("n.new")?.text).toBe("fresh node");
      const root = present(s.nodes.get(WORKSPACE_ROOT_ID), "workspace root");
      expect(root.children).toContain("n.new");
      const qdb = present(s.queryDb, "query db");
      expect(qdb.ids.toEid.has("n.new")).toBe(true);
      expect(qdb.rev).toBe(2);
    });

    it("updates existing node text in place", () => {
      seed();
      const cur = present(
        useOutlineStore.getState().wireNodes.find((n) => n.id === "n.root-b"),
        "n.root-b wire",
      );
      useOutlineStore.getState().applyTx([{ ...cur, text: "renamed" }], [], { rev: 2 });
      expect(useOutlineStore.getState().nodes.get("n.root-b")?.text).toBe("renamed");
    });

    it("deletes nodes", () => {
      seed();
      useOutlineStore.getState().applyTx([], ["n.root-c"], { rev: 2 });
      const s = useOutlineStore.getState();
      expect(s.nodes.has("n.root-c")).toBe(false);
      const root = present(s.nodes.get(WORKSPACE_ROOT_ID), "workspace root");
      expect(root.children).not.toContain("n.root-c");
    });

    it("preserves collapse state across deltas", () => {
      seed();
      useOutlineStore.getState().toggleCollapse("n.root-a");
      expect(useOutlineStore.getState().nodes.get("n.root-a")?.collapsed).toBe(false);
      useOutlineStore.getState().applyTx([wire("n.new", "x")], [], { rev: 2 });
      expect(useOutlineStore.getState().nodes.get("n.root-a")?.collapsed).toBe(false);
    });

    it("preserves zoom + selection when targets survive", () => {
      seed();
      useOutlineStore.getState().zoomTo("n.root-a");
      useOutlineStore.getState().applyTx([wire("n.new", "x")], [], { rev: 2 });
      const s = useOutlineStore.getState();
      expect(s.rootNodeId).toBe("n.root-a");
      expect(s.selectedNodeId).toBe("n.root-a");
    });

    it("falls back to home when the zoomed node is deleted", () => {
      seed();
      useOutlineStore.getState().zoomTo("n.root-c");
      useOutlineStore.getState().applyTx([], ["n.root-c"], { rev: 2 });
      const s = useOutlineStore.getState();
      expect(s.rootNodeId).toBe(WORKSPACE_ROOT_ID);
      expect(s.selectedNodeId).toBeNull();
    });
  });
});
