import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { present } from "@kb/model";
import { fixtureGraph } from "@/api/fixture-graph";
import { outlineInstanceKey, syncUiPlugins, WORKSPACE_ROOT_ID } from "@kb/ui-sdk";
import { resetOutlineStore } from "@/test-support/outline-store";
import { useUiStore } from "@/stores/ui.store";
import { useGraphStore } from "@/stores/graph.store";
import { useOutlineStore, outlineNodes } from "@/stores/outline.store";
import { outlineUiPlugin } from "@/components/outline/plugin";
import { outlineGraph } from "@/stores/graph-read";

// The outline runs as the app boots it: its frame views provided, and the
// store's row walk wired to them.
beforeAll(() => syncUiPlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

function seed() {
  useGraphStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
}

const wire = (id: string, text: string) => ({
  id,
  text,
  props: {},
  children: [],
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-08T00:00:00.000Z",
});

/** Every notification any reader of the outline can get, as what it then sees. */
function watch(look: () => void): () => void {
  const offs = [
    useGraphStore.subscribe(look),
    useOutlineStore.subscribe(look),
    outlineGraph.subscribe(look),
  ];
  return () => {
    for (const off of offs) off();
  };
}

describe("outline store (WireNode adaptation)", () => {
  beforeEach(() => {
    resetOutlineStore();
  });

  it("hydrates forest roots under virtual workspace root (id-sorted)", () => {
    seed();
    const root = present(outlineNodes().get(WORKSPACE_ROOT_ID), "workspace root");
    expect(root.children).toEqual(["lens.all-mentions", "n.root-a", "n.root-b", "n.root-c"]);
    expect(root.children).not.toContain("sys.tag");
    expect(root.children).not.toContain("tag.todo");
  });

  it("preserves ordered children arrays (no fractional order)", () => {
    seed();
    const a = present(outlineNodes().get("n.root-a"), "n.root-a");
    expect(a.children).toEqual(["n.child-a1", "n.child-a2"]);
    expect(a).not.toHaveProperty("order");
  });

  it("resolves tags from sys.f.type refs", () => {
    seed();
    const a = present(outlineNodes().get("n.root-a"), "n.root-a");
    expect(a.tags).toEqual([{ id: "tag.todo", name: "todo", color: expect.any(String) }]);
  });

  it("keeps the object of every node a transaction did not change", () => {
    seed();
    const before = outlineNodes();
    const target = present(
      fixtureGraph.nodes.find((n) => n.id === "n.child-a1"),
      "n.child-a1",
    );
    useGraphStore.getState().applyTx([{ ...target, text: "renamed" }], [], { rev: 2 });
    const after = outlineNodes();
    expect(after).not.toBe(before);
    expect(after.get("n.child-a1")).not.toBe(before.get("n.child-a1"));
    expect(after.get("n.child-a1")?.text).toBe("renamed");
    const changed = [...after.keys()].filter((id) => after.get(id) !== before.get(id));
    expect(changed).toEqual(["n.child-a1"]);

    // Expansion replaces only the toggled node.
    useOutlineStore.getState().toggleCollapse("n.root-a");
    const toggled = outlineNodes();
    expect([...toggled.keys()].filter((id) => toggled.get(id) !== after.get(id))).toEqual([
      "n.root-a",
    ]);
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
    useGraphStore.getState().zoomTo("n.root-b");
    useOutlineStore.getState().activateNode("n.child-a1", 0);
    expect(useOutlineStore.getState().activeNodeId).toBeNull();
    expect(useOutlineStore.getState().pendingCaret).toBeNull();
  });

  it("defaults expandable nodes collapsed; visible list shows roots only", () => {
    seed();
    expect(outlineNodes().get("n.root-a")?.collapsed).toBe(true);
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
    expect(outlineNodes().get("n.root-b")?.collapsed).toBe(true);
  });

  it("toggleCollapse expands field-only nodes", () => {
    seed();
    useOutlineStore.getState().toggleCollapse("n.root-b");
    expect(outlineNodes().get("n.root-b")?.collapsed).toBe(false);
  });

  it("does nothing when toggling a leaf without fields or children", () => {
    seed();
    useOutlineStore.getState().toggleCollapse("n.root-c");
    expect(outlineNodes().get("n.root-c")?.collapsed).toBe(false);
  });

  it("expandAllInScope expands every expandable node in the forest", () => {
    seed();
    useOutlineStore.getState().expandAllInScope();
    expect(outlineNodes().get("n.root-a")?.collapsed).toBe(false);
    expect(outlineNodes().get("n.root-b")?.collapsed).toBe(false);
    expect(outlineNodes().get("n.child-a2")?.collapsed).toBe(false);
  });

  it("collapseAllInScope collapses expandable nodes in the current scope", () => {
    seed();
    useOutlineStore.getState().expandAllInScope();
    useOutlineStore.getState().collapseAllInScope();
    expect(outlineNodes().get("n.root-a")?.collapsed).toBe(true);
    expect(outlineNodes().get("n.root-b")?.collapsed).toBe(true);
  });

  it("expand/collapse all respects zoomed subtree scope", () => {
    seed();
    useGraphStore.getState().zoomTo("n.root-a");
    useOutlineStore.getState().expandAllInScope();
    expect(outlineNodes().get("n.root-a")?.collapsed).toBe(true);
    expect(outlineNodes().get("n.child-a1")?.collapsed).toBe(false);
    expect(outlineNodes().get("n.root-b")?.collapsed).toBe(true);
  });

  it("zoomTo selects the first visible row under the root, never the root itself", () => {
    seed();
    useUiStore.setState({ toasts: [] });
    useGraphStore.getState().zoomTo("n.root-a");
    const s = useOutlineStore.getState();
    expect(s.selectedNodeId).toBe("n.child-a1");
    expect(s.getVisibleInstances().some((i) => i.instanceKey === s.selectedInstanceKey)).toBe(true);
    // A typed key re-enters the selected row: an anchor that is visible, so no
    // "not visible" toast (closing audit P1-7).
    const selected = s.selectedNodeId;
    if (selected !== null) s.activateNode(selected, 0, s.selectedInstanceKey ?? undefined);
    expect(useOutlineStore.getState().activeNodeId).toBe("n.child-a1");
    expect(useUiStore.getState().toasts).toEqual([]);
  });

  it("zoomTo a leaf selects nothing", () => {
    seed();
    useGraphStore.getState().zoomTo("n.child-a1");
    expect(useOutlineStore.getState().selectedNodeId).toBeNull();
  });

  it("zoomTo shows the root's breadcrumbs, and home none", () => {
    seed();
    useGraphStore.getState().zoomTo("n.root-a");
    expect(useOutlineStore.getState().getBreadcrumbs()).toEqual([
      { id: "n.root-a", text: "Ship kb ui shell" },
    ]);
    useGraphStore.getState().zoomHome();
    expect(useOutlineStore.getState().getBreadcrumbs()).toEqual([]);
  });

  it("getPrevious / getNext respect collapsed subtrees", () => {
    seed();
    useOutlineStore.getState().toggleCollapse("n.root-a");
    const s = useOutlineStore.getState();
    const aKey = outlineInstanceKey("n.root-a", outlineNodes());
    const bKey = outlineInstanceKey("n.root-b", outlineNodes());
    expect(present(s.getNextVisibleInstance(aKey), "next of n.root-a").nodeId).toBe("n.child-a1");
    expect(present(s.getPreviousVisibleInstance(bKey), "prev of n.root-b").nodeId).toBe(
      "n.child-a2",
    );
  });

  describe("applyTx (WS delta seam)", () => {
    it("projects an upserted node under the workspace root", () => {
      seed();
      useGraphStore.getState().applyTx([wire("n.new", "fresh node")], [], { rev: 2 });
      expect(outlineNodes().get("n.new")?.text).toBe("fresh node");
      const root = present(outlineNodes().get(WORKSPACE_ROOT_ID), "workspace root");
      expect(root.children).toContain("n.new");
    });

    it("updates existing node text in place", () => {
      seed();
      const cur = present(
        useGraphStore.getState().wireNodes.find((n) => n.id === "n.root-b"),
        "n.root-b wire",
      );
      useGraphStore.getState().applyTx([{ ...cur, text: "renamed" }], [], { rev: 2 });
      expect(outlineNodes().get("n.root-b")?.text).toBe("renamed");
    });

    it("deletes nodes", () => {
      seed();
      useGraphStore.getState().applyTx([], ["n.root-c"], { rev: 2 });
      expect(outlineNodes().has("n.root-c")).toBe(false);
      const root = present(outlineNodes().get(WORKSPACE_ROOT_ID), "workspace root");
      expect(root.children).not.toContain("n.root-c");
    });

    it("preserves collapse state across deltas", () => {
      seed();
      useOutlineStore.getState().toggleCollapse("n.root-a");
      expect(outlineNodes().get("n.root-a")?.collapsed).toBe(false);
      useGraphStore.getState().applyTx([wire("n.new", "x")], [], { rev: 2 });
      expect(outlineNodes().get("n.root-a")?.collapsed).toBe(false);
    });

    it("preserves zoom + selection when targets survive", () => {
      seed();
      useGraphStore.getState().zoomTo("n.root-a");
      useGraphStore.getState().applyTx([wire("n.new", "x")], [], { rev: 2 });
      const s = useOutlineStore.getState();
      const graph = useGraphStore.getState();
      expect(graph.rootNodeId).toBe("n.root-a");
      expect(s.selectedNodeId).toBe("n.child-a1");
    });

    it("drops the selection when the zoomed node is deleted", () => {
      seed();
      useGraphStore.getState().zoomTo("n.root-c");
      useGraphStore.getState().applyTx([], ["n.root-c"], { rev: 2 });
      expect(useOutlineStore.getState().selectedNodeId).toBeNull();
    });
  });

  describe("what a reader can see during a move", () => {
    it("never the graph beside rows of another snapshot: the rows are read from it", () => {
      seed();
      const seen: boolean[] = [];
      const stop = watch(() => {
        const inGraph = useGraphStore.getState().wireNodes.some((n) => n.id === "n.new");
        seen.push(inGraph === outlineNodes().has("n.new"));
      });
      useGraphStore.getState().applyTx([wire("n.new", "x")], [], { rev: 2 });
      useGraphStore.getState().applyTx([], ["n.new"], { rev: 3 });
      stop();
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every(Boolean)).toBe(true);
    });

    it("never a focus on a row the graph it is seen with does not show", () => {
      seed();
      useOutlineStore.getState().selectNode("n.root-c");
      const seen: boolean[] = [];
      const stop = watch(() => {
        const { selectedNodeId } = useOutlineStore.getState();
        seen.push(selectedNodeId === null || outlineNodes().has(selectedNodeId));
      });
      useGraphStore.getState().applyTx([], ["n.root-c"], { rev: 2 });
      stop();
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every(Boolean)).toBe(true);
      expect(useOutlineStore.getState().selectedNodeId).toBeNull();
    });

    it("a zoom lands the selection before the root moves: never the new root with the old one", () => {
      seed();
      useOutlineStore.getState().selectNode("n.root-c");
      const seen: Array<[string, string | null]> = [];
      const stop = watch(() =>
        seen.push([useGraphStore.getState().rootNodeId, useOutlineStore.getState().selectedNodeId]),
      );
      useGraphStore.getState().zoomTo("n.root-a");
      stop();
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every(([, selected]) => selected === "n.child-a1")).toBe(true);
      expect(seen.at(-1)).toEqual(["n.root-a", "n.child-a1"]);
    });

    it("a jump out of the zoom edits the row only once the page is home and the row shows", () => {
      // The jump scrolls its row into view after paint; there is no paint here.
      vi.stubGlobal("requestAnimationFrame", () => 0);
      seed();
      useGraphStore.getState().zoomTo("n.root-b");
      const seen: Array<[string, string | null, boolean]> = [];
      const stop = watch(() => {
        const outline = useOutlineStore.getState();
        seen.push([
          useGraphStore.getState().rootNodeId,
          outline.activeNodeId,
          outlineNodes().get("n.child-a2")?.collapsed === false,
        ]);
      });
      useOutlineStore.getState().jumpToNode("n.grandchild");
      stop();
      vi.unstubAllGlobals();
      expect(seen.length).toBeGreaterThan(0);
      for (const [root, active, open] of seen) {
        if (active !== null)
          expect([root, active, open]).toEqual([WORKSPACE_ROOT_ID, "n.grandchild", true]);
      }
      expect(seen.at(-1)).toEqual([WORKSPACE_ROOT_ID, "n.grandchild", true]);
    });

    it("a jump to a row no outline shows leaves the page where it was", () => {
      seed();
      useGraphStore.getState().zoomTo("n.root-b");
      useOutlineStore.getState().selectNode("n.root-b");
      // A field definition is in the graph but in no outline's forest.
      useOutlineStore.getState().jumpToNode("field.status");
      expect(useGraphStore.getState().rootNodeId).toBe("n.root-b");
      expect(useOutlineStore.getState().selectedNodeId).toBe("n.root-b");
    });
  });
});
