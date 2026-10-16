/**
 * r1 D19 — action-level undo/redo across destructive outline operations.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { mutations } from "@/actions/mutations";
import { mergeWithPrevious } from "@/components/outline/editing-writes";
import { fixtureGraph } from "@/api/fixture-graph";
import { syncUiPlugins, WORKSPACE_ROOT_ID } from "@kb/ui-sdk";
import { useGraphStore } from "@/stores/graph.store";
import { useOutlineStore, outlineNodes } from "@/components/outline/outline.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { outlineUiPlugin } from "@/components/outline/plugin";

// The outline runs as the app boots it: its frame views provided, and the
// store's row walk wired to them.
beforeAll(() => syncPagePlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

function seed() {
  resetOutlineStore();
  useGraphStore
    .getState()
    .hydrateFromWire(structuredClone(fixtureGraph.nodes), fixtureGraph.rev, "fixtures");
}

describe("undo / redo (D19)", () => {
  beforeEach(seed);

  it("restores a deleted subtree with Cmd+Z", async () => {
    const before = useGraphStore.getState().wireNodes.length;
    await mutations.deleteNode("n.root-b");
    expect(useGraphStore.getState().wireNodes.length).toBe(before - 1);
    expect(outlineNodes().has("n.root-b")).toBe(false);

    await mutations.undo();

    const graph = useGraphStore.getState();
    expect(graph.wireNodes.length).toBe(before);
    expect(outlineNodes().get("n.root-b")?.text).toBe("Search jumps to matching nodes");
    // Children of the deleted node come back too.
    expect(present(outlineNodes().get(WORKSPACE_ROOT_ID), WORKSPACE_ROOT_ID).children).toContain(
      "n.root-b",
    );
  });

  it("undoes a split: minted sibling disappears again", async () => {
    await mutations.splitNode("n.root-c", 4); // "Read-only props panel…" → two rows
    const mid = useGraphStore.getState();
    expect(mid.wireNodes.length).toBe(fixtureGraph.nodes.length + 1);

    await mutations.undo();
    expect(useGraphStore.getState().wireNodes.length).toBe(fixtureGraph.nodes.length);
    expect(outlineNodes().get("n.root-c")?.text).toBe("Read-only props panel resolves field names");
    void mid;

    await mutations.redo();
    expect(useGraphStore.getState().wireNodes.length).toBe(fixtureGraph.nodes.length + 1);
    expect(outlineNodes().get("n.root-c")?.text).toBe("Read");
  });

  it("undoes an indent: node returns to its previous parent", async () => {
    act(() => {
      useOutlineStore.getState().toggleCollapse("n.root-a");
    });
    await mutations.indentNode("n.root-b");
    expect(outlineNodes().get("n.root-b")?.parentId).toBe("n.root-a");

    await mutations.undo();
    expect(outlineNodes().get("n.root-b")?.parentId).toBe(WORKSPACE_ROOT_ID);
    expect(outlineNodes().get("n.root-a")?.children).not.toContain("n.root-b");
    expect(outlineNodes().get("n.root-a")?.children).toEqual(["n.child-a1", "n.child-a2"]);
  });

  it("restores replaced properties through canonical unset then set actions", async () => {
    await mutations.updateProp(
      "n.root-a",
      "field.status",
      { t: "str", v: "done" },
      { t: "str", v: "doing" },
    );
    expect(outlineNodes().get("n.root-a")?.props["field.status"]).toEqual([
      { t: "str", v: "done" },
    ]);

    await mutations.undo();
    expect(outlineNodes().get("n.root-a")?.props["field.status"]).toEqual([
      { t: "str", v: "doing" },
    ]);
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

    await mergeWithPrevious("n.root-b", bKey);
    expect(outlineNodes().has("n.root-b")).toBe(false);
    expect(outlineNodes().get("n.grandchild")?.text).toContain("Search jumps to matching nodes");

    await mutations.undo();
    expect(outlineNodes().has("n.root-b")).toBe(true);
    expect(outlineNodes().get("n.root-b")?.text).toBe("Search jumps to matching nodes");
    expect(outlineNodes().get("n.grandchild")?.text).toBe("Persist collapsed ids in localStorage");
  });

  it("a new structural mutation clears the redo stack", async () => {
    await mutations.splitNode("n.root-c", 4);
    await mutations.undo();
    expect(useGraphStore.getState().redoStack.length).toBeGreaterThan(0);

    await mutations.indentNode("n.root-c");
    expect(useGraphStore.getState().redoStack.length).toBe(0);
  });

  it("no-ops cleanly on empty stacks", async () => {
    expect(await mutations.undo()).toBe(false);
    expect(await mutations.redo()).toBe(false);
  });
});

// Minimal act shim: zustand setState is synchronous; import kept local so
// the file also runs under plain bun without react-dom/test-utils.
import { act } from "react";
import { syncPagePlugins } from "@/test-support/page-plugins";
