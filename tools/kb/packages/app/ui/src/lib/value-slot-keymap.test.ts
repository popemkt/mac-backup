import { describe, expect, it } from "vitest";
import { valueSlotIntent, type ValueSlotKeyState } from "@/lib/value-slot-keymap";

const editingCaret: ValueSlotKeyState = {
  editing: true,
  keys: "slot",
  composing: false,
  canFollow: false,
  addsOnEnter: () => false,
};

describe("value slot keymap", () => {
  it("a slot at rest has no business with any key", () => {
    for (const key of ["Enter", "Escape", "a", "ArrowDown"]) {
      expect(valueSlotIntent({ key }, { ...editingCaret, editing: false })).toBeNull();
    }
  });

  it("an editing caret slot commits on Enter and reverts on Escape", () => {
    expect(valueSlotIntent({ key: "Enter" }, editingCaret)).toBe("commit");
    expect(valueSlotIntent({ key: "Escape" }, editingCaret)).toBe("cancel");
  });

  it("Shift+Enter is a line break inside the value", () => {
    expect(valueSlotIntent({ key: "Enter", shiftKey: true }, editingCaret)).toBe("softBreak");
  });

  it("every other key an editing slot receives stays inside it", () => {
    expect(valueSlotIntent({ key: "a" }, editingCaret)).toBe("contain");
    expect(valueSlotIntent({ key: "Tab" }, editingCaret)).toBe("contain");
  });

  it("an IME composition keeps its Enter", () => {
    expect(valueSlotIntent({ key: "Enter" }, { ...editingCaret, composing: true })).toBe("contain");
  });

  it("⌘Enter follows a value that points somewhere, at rest or editing", () => {
    const pointing = { ...editingCaret, canFollow: true };
    expect(valueSlotIntent({ key: "Enter", metaKey: true }, pointing)).toBe("follow");
    expect(valueSlotIntent({ key: "Enter", ctrlKey: true }, { ...pointing, editing: false })).toBe(
      "follow",
    );
    // A value that points nowhere has nothing to follow: at rest the key is
    // not the slot's, and while editing it is an Enter like any other.
    expect(
      valueSlotIntent({ key: "Enter", metaKey: true }, { ...editingCaret, editing: false }),
    ).toBeNull();
    expect(valueSlotIntent({ key: "Enter", metaKey: true }, editingCaret)).toBe("commit");
  });

  it("an editor that owns its keys keeps Enter and Escape for itself", () => {
    const picker: ValueSlotKeyState = {
      editing: true,
      keys: "editor",
      composing: false,
      canFollow: true,
      addsOnEnter: () => true,
    };
    expect(valueSlotIntent({ key: "Enter" }, picker)).toBe("contain");
    expect(valueSlotIntent({ key: "Escape" }, picker)).toBe("contain");
  });

  it("Enter at the end of a many-valued field's value adds the next one", () => {
    expect(valueSlotIntent({ key: "Enter" }, { ...editingCaret, addsOnEnter: () => true })).toBe(
      "commitAndAdd",
    );
    // Anywhere else, or in a one-valued field, Enter only commits.
    expect(valueSlotIntent({ key: "Enter" }, editingCaret)).toBe("commit");
  });
});
