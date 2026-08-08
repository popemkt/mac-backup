import { describe, expect, it } from "vitest";
import { mapSelectionKey } from "@/lib/selection-keymap";
import type { VisibleInstance } from "@/lib/visible-instances";

const instances: VisibleInstance[] = [
  { nodeId: "a", instanceKey: "tree/a" },
  { nodeId: "b", instanceKey: "tree/b" },
  { nodeId: "c", instanceKey: "tree/c" },
];

function ctx(
  selected: string | null,
  active: string | null = null,
  selectedKey: string | null = selected ? `tree/${selected}` : null,
) {
  return {
    selectedNodeId: selected,
    selectedInstanceKey: selectedKey,
    activeNodeId: active,
    getPreviousVisibleInstance: (key: string) => {
      const i = instances.findIndex((x) => x.instanceKey === key);
      return i > 0 ? instances[i - 1]! : null;
    },
    getNextVisibleInstance: (key: string) => {
      const i = instances.findIndex((x) => x.instanceKey === key);
      return i >= 0 && i < instances.length - 1 ? instances[i + 1]! : null;
    },
  };
}

describe("mapSelectionKey", () => {
  it("ignores keys while editing or with no selection", () => {
    expect(mapSelectionKey("ArrowDown", ctx("a", "a"))).toBeNull();
    expect(mapSelectionKey("Enter", ctx(null))).toBeNull();
  });

  it("ArrowUp/Down select neighbors by instanceKey", () => {
    expect(mapSelectionKey("ArrowDown", ctx("a"))).toEqual({
      type: "select",
      nodeId: "b",
      instanceKey: "tree/b",
    });
    expect(mapSelectionKey("ArrowUp", ctx("b"))).toEqual({
      type: "select",
      nodeId: "a",
      instanceKey: "tree/a",
    });
    expect(mapSelectionKey("ArrowUp", ctx("a"))).toBeNull();
  });

  it("Enter edits, Space toggles collapse, o creates after", () => {
    expect(mapSelectionKey("Enter", ctx("b"))).toEqual({
      type: "edit",
      nodeId: "b",
      instanceKey: "tree/b",
    });
    expect(mapSelectionKey(" ", ctx("b"))).toEqual({
      type: "toggleCollapse",
      nodeId: "b",
    });
    expect(mapSelectionKey("o", ctx("b"))).toEqual({
      type: "createAfter",
      nodeId: "b",
    });
  });

  it("Backspace/Delete delete; Escape clears", () => {
    expect(mapSelectionKey("Backspace", ctx("c"))).toEqual({
      type: "delete",
      nodeId: "c",
      instanceKey: "tree/c",
    });
    expect(mapSelectionKey("Delete", ctx("c"))).toEqual({
      type: "delete",
      nodeId: "c",
      instanceKey: "tree/c",
    });
    expect(mapSelectionKey("Escape", ctx("c"))).toEqual({ type: "clear" });
  });
});
