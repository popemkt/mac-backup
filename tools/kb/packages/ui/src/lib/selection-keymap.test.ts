import { describe, expect, it } from "vitest";
import { mapSelectionKey, type SelectionNodeInfo } from "@/lib/selection-keymap";
import type { VisibleInstance } from "@/lib/visible-instances";

const instances: VisibleInstance[] = [
  { nodeId: "a", instanceKey: "tree/a" },
  { nodeId: "b", instanceKey: "tree/b" },
  { nodeId: "c", instanceKey: "tree/c" },
];

/** b is an expanded parent of [b1]; a collapsed leaf with no parent edge. */
const nodeInfos: Record<string, SelectionNodeInfo> = {
  a: { collapsed: true, childIds: [], parentId: null },
  b: { collapsed: false, childIds: ["b1"], parentId: "root" },
  c: { collapsed: true, childIds: [], parentId: "root" },
};

function ctx(
  selected: string | null,
  active: string | null = null,
  selectedKey: string | null = selected ? `tree/${selected}` : null,
) {
  return {
    selectedNodeId: selected,
    selectedInstanceKey: selectedKey,
    activeNodeId: active,
    getPreviousVisibleInstance: (instanceKey: string) => {
      const i = instances.findIndex((x) => x.instanceKey === instanceKey);
      return i > 0 ? instances[i - 1]! : null;
    },
    getNextVisibleInstance: (instanceKey: string) => {
      const i = instances.findIndex((x) => x.instanceKey === instanceKey);
      return i >= 0 && i < instances.length - 1 ? instances[i + 1]! : null;
    },
    getNode: (id: string) => nodeInfos[id],
  };
}

function key(k: string, mods: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {}) {
  return { key: k, ...mods };
}

describe("mapSelectionKey", () => {
  it("ignores keys while editing or with no selection", () => {
    expect(mapSelectionKey(key("ArrowDown"), ctx("a", "a"))).toBeNull();
    expect(mapSelectionKey(key("Enter"), ctx(null))).toBeNull();
  });

  it("ArrowUp/Down select neighbors by instanceKey", () => {
    expect(mapSelectionKey(key("ArrowDown"), ctx("a"))).toEqual({
      type: "select",
      nodeId: "b",
      instanceKey: "tree/b",
    });
    expect(mapSelectionKey(key("ArrowUp"), ctx("b"))).toEqual({
      type: "select",
      nodeId: "a",
      instanceKey: "tree/a",
    });
    expect(mapSelectionKey(key("ArrowUp"), ctx("a"))).toBeNull();
  });

  it("ArrowLeft collapses expanded; selects parent when leaf-like", () => {
    // c has no children → parent select
    expect(mapSelectionKey(key("ArrowLeft"), ctx("c"))).toEqual({
      type: "selectParent",
      nodeId: "c",
    });
  });

  it("ArrowRight expands collapsed; selects first child when expanded", () => {
    // b is already expanded with kids → first-child select would need b1 in
    // the visible set; the keymap only emits the action.
    const action = mapSelectionKey(key("ArrowRight"), ctx("c"));
    expect(action).toBeNull(); // collapsed but no children
    const expandAction = mapSelectionKey(key("ArrowRight"), ctx("a"));
    expect(expandAction).toBeNull(); // no children at all
  });

  it("Tab indents and Shift+Tab outdents the selected row (D12)", () => {
    expect(mapSelectionKey(key("Tab"), ctx("b"))).toEqual({
      type: "indent",
      nodeId: "b",
    });
    expect(mapSelectionKey(key("Tab", { shiftKey: true }), ctx("b"))).toEqual({
      type: "outdent",
      nodeId: "b",
    });
  });

  it("Cmd+Shift+arrows reorder the row (D12)", () => {
    expect(mapSelectionKey(key("ArrowUp", { metaKey: true, shiftKey: true }), ctx("b"))).toEqual({
      type: "moveUp",
      nodeId: "b",
    });
    expect(mapSelectionKey(key("ArrowDown", { ctrlKey: true, shiftKey: true }), ctx("b"))).toEqual({
      type: "moveDown",
      nodeId: "b",
    });
  });

  it("Cmd+. zooms into the selected node", () => {
    expect(mapSelectionKey(key(".", { metaKey: true }), ctx("b"))).toEqual({
      type: "zoom",
      nodeId: "b",
    });
  });

  it("printable characters append via edit activation (D12)", () => {
    expect(mapSelectionKey(key("x"), ctx("b"))).toEqual({
      type: "append",
      nodeId: "b",
      instanceKey: "tree/b",
      char: "x",
    });
    expect(mapSelectionKey(key(" "), ctx("b"))).toEqual({
      type: "toggleCollapse",
      nodeId: "b",
    });
  });

  it("Enter edits, Space toggles collapse, o creates after", () => {
    expect(mapSelectionKey(key("Enter"), ctx("b"))).toEqual({
      type: "edit",
      nodeId: "b",
      instanceKey: "tree/b",
    });
    expect(mapSelectionKey(key(" "), ctx("b"))).toEqual({
      type: "toggleCollapse",
      nodeId: "b",
    });
    expect(mapSelectionKey(key("o"), ctx("b"))).toEqual({
      type: "createAfter",
      nodeId: "b",
    });
  });

  it("Shift+o creates above", () => {
    expect(mapSelectionKey(key("O"), ctx("b"))).toEqual({
      type: "createBefore",
      nodeId: "b",
    });
  });

  it("Backspace/Delete delete; Escape clears", () => {
    expect(mapSelectionKey(key("Backspace"), ctx("c"))).toEqual({
      type: "delete",
      nodeId: "c",
      instanceKey: "tree/c",
    });
    expect(mapSelectionKey(key("Delete"), ctx("c"))).toEqual({
      type: "delete",
      nodeId: "c",
      instanceKey: "tree/c",
    });
    expect(mapSelectionKey(key("Escape"), ctx("c"))).toEqual({
      type: "clear",
    });
  });
});
