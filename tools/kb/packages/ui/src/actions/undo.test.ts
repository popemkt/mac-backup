/**
 * r1 D19 — action-level undo/redo across destructive outline operations.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { mutations } from "@/actions/mutations";
import { fixtureGraph } from "@/fixtures/graph";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";

function seed() {
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
    focusSeq: 0,
    focusX: null,
    transientIds: new Set<string>(),
    undoStack: [],
    redoStack: [],
  });
  useOutlineStore
    .getState()
    .hydrateFromWire(structuredClone(fixtureGraph.nodes), fixtureGraph.rev, "fixtures");
}

describe("undo / redo (D19)", () => {
  beforeEach(seed);

  it("restores a deleted subtree with Cmd+Z", async () => {
    const before = useOutlineStore.getState().wireNodes.length;
    await mutations.deleteNode("n.root-b");
    expect(useOutlineStore.getState().wireNodes.length).toBe(before - 1);
    expect(useOutlineStore.getState().nodes.has("n.root-b")).toBe(false);

    await mutations.undo();

    const s = useOutlineStore.getState();
    expect(s.wireNodes.length).toBe(before);
    expect(s.nodes.get("n.root-b")?.text).toBe("Search jumps to matching nodes");
    // Children of the deleted node come back too.
    expect(present(s.nodes.get(WORKSPACE_ROOT_ID), WORKSPACE_ROOT_ID).children).toContain(
      "n.root-b",
    );
  });

  it("undoes a split: minted sibling disappears again", async () => {
    await mutations.splitNode("n.root-c", 4); // "Read-only props panel…" → two rows
    const mid = useOutlineStore.getState();
    expect(mid.wireNodes.length).toBe(fixtureGraph.nodes.length + 1);

    await mutations.undo();
    const undone = useOutlineStore.getState();
    expect(undone.wireNodes.length).toBe(fixtureGraph.nodes.length);
    expect(undone.nodes.get("n.root-c")?.text).toBe("Read-only props panel resolves field names");
    void mid;

    await mutations.redo();
    const redone = useOutlineStore.getState();
    expect(redone.wireNodes.length).toBe(fixtureGraph.nodes.length + 1);
    expect(redone.nodes.get("n.root-c")?.text).toBe("Read");
  });

  it("undoes an indent: node returns to its previous parent", async () => {
    act(() => {
      useOutlineStore.getState().toggleCollapse("n.root-a");
    });
    await mutations.indentNode("n.root-b");
    expect(useOutlineStore.getState().nodes.get("n.root-b")?.parentId).toBe("n.root-a");

    await mutations.undo();
    const s = useOutlineStore.getState();
    expect(s.nodes.get("n.root-b")?.parentId).toBe(WORKSPACE_ROOT_ID);
    expect(s.nodes.get("n.root-a")?.children).not.toContain("n.root-b");
    expect(s.nodes.get("n.root-a")?.children).toEqual(["n.child-a1", "n.child-a2"]);
  });

  it("undoes a visual merge into an expanded descendant (D09 pairing)", async () => {
    // Expand root-a → child-a2 chain so the visual predecessor of root-b
    // (the next root row) is its deepest last descendant, n.grandchild.
    act(() => {
      useOutlineStore.getState().toggleCollapse("n.root-a");
      useOutlineStore.getState().toggleCollapse("n.child-a2");
    });
    const bKey = "tree/n.root-b";
    const s = useOutlineStore.getState();
    expect(s.getPreviousVisibleInstance(bKey)?.nodeId).toBe("n.grandchild");

    await mutations.mergeWithPrevious("n.root-b", bKey);
    const merged = useOutlineStore.getState();
    expect(merged.nodes.has("n.root-b")).toBe(false);
    expect(merged.nodes.get("n.grandchild")?.text).toContain("Search jumps to matching nodes");

    await mutations.undo();
    const undone = useOutlineStore.getState();
    expect(undone.nodes.has("n.root-b")).toBe(true);
    expect(undone.nodes.get("n.root-b")?.text).toBe("Search jumps to matching nodes");
    expect(undone.nodes.get("n.grandchild")?.text).toBe("Persist collapsed ids in localStorage");
  });

  it("a new structural mutation clears the redo stack", async () => {
    await mutations.splitNode("n.root-c", 4);
    await mutations.undo();
    expect(useOutlineStore.getState().redoStack.length).toBeGreaterThan(0);

    await mutations.indentNode("n.root-c");
    expect(useOutlineStore.getState().redoStack.length).toBe(0);
  });

  it("no-ops cleanly on empty stacks", async () => {
    expect(await mutations.undo()).toBe(false);
    expect(await mutations.redo()).toBe(false);
  });
});

// Minimal act shim: zustand setState is synchronous; import kept local so
// the file also runs under plain bun without react-dom/test-utils.
import { act } from "react";
