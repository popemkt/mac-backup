import { describe, expect, it } from "vitest";
import { present } from "@kb/model";
import {
  mapSelectionKey,
  type SelectionKeyAction,
  type SelectionKeyEvent,
  type SelectionNodeInfo,
} from "@/lib/selection-keymap";
import type { VisibleInstance } from "@/lib/visible-instances";

const instances: VisibleInstance[] = [
  { nodeId: "a", instanceKey: "tree/a" },
  { nodeId: "b", instanceKey: "tree/b" },
  { nodeId: "c", instanceKey: "tree/c" },
];

/**
 * b is an expanded parent of [b1]; a collapsed leaf with no parent edge;
 * d a collapsed parent; `unknown` has no entry at all, which is how a
 * selection that outran the node map reaches the mapper.
 */
const nodeInfos: Record<string, SelectionNodeInfo> = {
  a: { collapsed: true, childIds: [], parentId: null },
  b: { collapsed: false, childIds: ["b1"], parentId: "root" },
  c: { collapsed: true, childIds: [], parentId: "root" },
  d: { collapsed: true, childIds: ["d1"], parentId: "root" },
};

function ctx(
  selected: string | null,
  active: string | null = null,
  selectedKey: string | null = selected !== null && selected !== "" ? `tree/${selected}` : null,
) {
  return {
    selectedNodeId: selected,
    selectedInstanceKey: selectedKey,
    activeNodeId: active,
    getPreviousVisibleInstance: (instanceKey: string) => {
      const i = instances.findIndex((x) => x.instanceKey === instanceKey);
      return i > 0 ? present(instances.at(i - 1), "previous instance") : null;
    },
    getNextVisibleInstance: (instanceKey: string) => {
      const i = instances.findIndex((x) => x.instanceKey === instanceKey);
      return i >= 0 && i < instances.length - 1
        ? present(instances.at(i + 1), "next instance")
        : null;
    },
    getNode: (id: string) => nodeInfos[id],
  };
}

function key(
  k: string,
  mods: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {},
): SelectionKeyEvent {
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

/**
 * The whole binding set, in the order the mapper resolves it (closed gap
 * [[01M1MGCH7SD69CRSSV75X789QW]]). First match wins, so the rows are the
 * chain read top to bottom: modifier combos, the modifier cutoff, then the
 * bare keys and the printable fall-through. This table is the gate for
 * turning the chain into data — it must pass unchanged on both sides.
 */
describe("mapSelectionKey chord table (characterization)", () => {
  const rows: Array<[string, SelectionKeyEvent, string, SelectionKeyAction | null]> = [
    // 1-2. Modifier combos, either spelling of "mod".
    [
      "Meta+Shift+ArrowUp",
      key("ArrowUp", { metaKey: true, shiftKey: true }),
      "b",
      { type: "moveUp", nodeId: "b" },
    ],
    [
      "Ctrl+Shift+ArrowUp",
      key("ArrowUp", { ctrlKey: true, shiftKey: true }),
      "b",
      { type: "moveUp", nodeId: "b" },
    ],
    [
      "Meta+Shift+ArrowDown",
      key("ArrowDown", { metaKey: true, shiftKey: true }),
      "b",
      { type: "moveDown", nodeId: "b" },
    ],
    [
      "Ctrl+Shift+ArrowDown",
      key("ArrowDown", { ctrlKey: true, shiftKey: true }),
      "b",
      { type: "moveDown", nodeId: "b" },
    ],
    // 3. Zoom ignores Shift, so it also claims Meta+Shift+".".
    ["Meta+.", key(".", { metaKey: true }), "b", { type: "zoom", nodeId: "b" }],
    ["Ctrl+.", key(".", { ctrlKey: true }), "b", { type: "zoom", nodeId: "b" }],
    [
      "Meta+Shift+.",
      key(".", { metaKey: true, shiftKey: true }),
      "b",
      { type: "zoom", nodeId: "b" },
    ],
    // 4. Every other modified chord is unhandled — the cutoff, not a default.
    ["Meta+k", key("k", { metaKey: true }), "b", null],
    ["Meta+ArrowUp", key("ArrowUp", { metaKey: true }), "b", null],
    ["Meta+Enter", key("Enter", { metaKey: true }), "b", null],
    ["Meta+Backspace", key("Backspace", { metaKey: true }), "b", null],
    ["Ctrl+Tab", key("Tab", { ctrlKey: true }), "b", null],
    // 5. Bare vertical movement, by instance key.
    [
      "ArrowUp with a predecessor",
      key("ArrowUp"),
      "b",
      { type: "select", nodeId: "a", instanceKey: "tree/a" },
    ],
    ["ArrowUp at the top", key("ArrowUp"), "a", null],
    [
      "ArrowDown with a successor",
      key("ArrowDown"),
      "b",
      { type: "select", nodeId: "c", instanceKey: "tree/c" },
    ],
    ["ArrowDown at the bottom", key("ArrowDown"), "c", null],
    // 6. ArrowLeft: close, else climb.
    ["ArrowLeft on an expanded parent", key("ArrowLeft"), "b", { type: "collapse", nodeId: "b" }],
    [
      "ArrowLeft on a leaf with a parent",
      key("ArrowLeft"),
      "c",
      { type: "selectParent", nodeId: "c" },
    ],
    ["ArrowLeft on a rootless leaf", key("ArrowLeft"), "a", null],
    ["ArrowLeft on an unknown node", key("ArrowLeft"), "unknown", null],
    // 7. ArrowRight: open, else descend.
    ["ArrowRight on a collapsed parent", key("ArrowRight"), "d", { type: "expand", nodeId: "d" }],
    [
      "ArrowRight on an expanded parent",
      key("ArrowRight"),
      "b",
      { type: "selectFirstChild", nodeId: "b" },
    ],
    ["ArrowRight on a leaf", key("ArrowRight"), "c", null],
    ["ArrowRight on an unknown node", key("ArrowRight"), "unknown", null],
    // 8. Enter edits, with or without Shift.
    ["Enter", key("Enter"), "b", { type: "edit", nodeId: "b", instanceKey: "tree/b" }],
    [
      "Shift+Enter",
      key("Enter", { shiftKey: true }),
      "b",
      { type: "edit", nodeId: "b", instanceKey: "tree/b" },
    ],
    // 9. All three spellings of the space bar toggle.
    ["Space", key(" "), "b", { type: "toggleCollapse", nodeId: "b" }],
    ['"Space"', key("Space"), "b", { type: "toggleCollapse", nodeId: "b" }],
    ['"Spacebar"', key("Spacebar"), "b", { type: "toggleCollapse", nodeId: "b" }],
    // 10. Tab, with Alt ignored.
    ["Tab", key("Tab"), "b", { type: "indent", nodeId: "b" }],
    ["Shift+Tab", key("Tab", { shiftKey: true }), "b", { type: "outdent", nodeId: "b" }],
    ["Alt+Tab", key("Tab", { altKey: true }), "b", { type: "indent", nodeId: "b" }],
    // 11. Case is the binding: o and O are two rows, not one plus a modifier.
    ["o", key("o"), "b", { type: "createAfter", nodeId: "b" }],
    ["O", key("O"), "b", { type: "createBefore", nodeId: "b" }],
    ["Shift+O", key("O", { shiftKey: true }), "b", { type: "createBefore", nodeId: "b" }],
    // 12. Delete, either key.
    ["Backspace", key("Backspace"), "c", { type: "delete", nodeId: "c", instanceKey: "tree/c" }],
    ["Delete", key("Delete"), "c", { type: "delete", nodeId: "c", instanceKey: "tree/c" }],
    ["Escape", key("Escape"), "c", { type: "clear" }],
    // 13. The printable fall-through, and what it declines.
    ["x", key("x"), "b", { type: "append", nodeId: "b", instanceKey: "tree/b", char: "x" }],
    ["X", key("X"), "b", { type: "append", nodeId: "b", instanceKey: "tree/b", char: "X" }],
    [
      "Shift+1",
      key("!", { shiftKey: true }),
      "b",
      { type: "append", nodeId: "b", instanceKey: "tree/b", char: "!" },
    ],
    ["Alt+x composes natively", key("x", { altKey: true }), "b", null],
    ["F5 is not printable", key("F5"), "b", null],
    ["ArrowRight-like unknown names are not printable", key("PageDown"), "b", null],
  ];

  it.each(rows)("%s", (_label, event, selected, expected) => {
    expect(mapSelectionKey(event, ctx(selected))).toEqual(expected);
  });

  it("declines every chord while editing or with nothing selected", () => {
    for (const [, event] of rows) {
      expect(mapSelectionKey(event, ctx("b", "b"))).toBeNull();
      expect(mapSelectionKey(event, ctx(null))).toBeNull();
      expect(mapSelectionKey(event, ctx("b", null, null))).toBeNull();
    }
  });
});
