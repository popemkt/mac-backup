import { describe, expect, it } from "vitest";
import { mapSelectionKey } from "@/lib/selection-keymap";

const ids = ["a", "b", "c"];

function ctx(selected: string | null, active: string | null = null) {
  return {
    selectedNodeId: selected,
    activeNodeId: active,
    getPreviousVisibleNode: (id: string) => {
      const i = ids.indexOf(id);
      return i > 0 ? ids[i - 1]! : null;
    },
    getNextVisibleNode: (id: string) => {
      const i = ids.indexOf(id);
      return i >= 0 && i < ids.length - 1 ? ids[i + 1]! : null;
    },
  };
}

describe("mapSelectionKey", () => {
  it("ignores keys while editing or with no selection", () => {
    expect(mapSelectionKey("ArrowDown", ctx("a", "a"))).toBeNull();
    expect(mapSelectionKey("Enter", ctx(null))).toBeNull();
  });

  it("ArrowUp/Down select neighbors", () => {
    expect(mapSelectionKey("ArrowDown", ctx("a"))).toEqual({
      type: "select",
      nodeId: "b",
    });
    expect(mapSelectionKey("ArrowUp", ctx("b"))).toEqual({
      type: "select",
      nodeId: "a",
    });
    expect(mapSelectionKey("ArrowUp", ctx("a"))).toBeNull();
  });

  it("Enter edits, Space toggles collapse, o creates after", () => {
    expect(mapSelectionKey("Enter", ctx("b"))).toEqual({
      type: "edit",
      nodeId: "b",
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
    });
    expect(mapSelectionKey("Delete", ctx("c"))).toEqual({
      type: "delete",
      nodeId: "c",
    });
    expect(mapSelectionKey("Escape", ctx("c"))).toEqual({ type: "clear" });
  });
});
