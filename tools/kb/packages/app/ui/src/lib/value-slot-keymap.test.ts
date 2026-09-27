import { describe, expect, it } from "vitest";
import { valueSlotIntent, type ValueSlotKeyState } from "@/lib/value-slot-keymap";

const editingCaret: ValueSlotKeyState = { editing: true, keys: "slot", composing: false };

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

  it("Shift+Enter is a line break, so the slot only contains it", () => {
    expect(valueSlotIntent({ key: "Enter", shiftKey: true }, editingCaret)).toBe("contain");
  });

  it("every other key an editing slot receives stays inside it", () => {
    expect(valueSlotIntent({ key: "a" }, editingCaret)).toBe("contain");
    expect(valueSlotIntent({ key: "Tab" }, editingCaret)).toBe("contain");
  });

  it("an IME composition keeps its Enter", () => {
    expect(valueSlotIntent({ key: "Enter" }, { ...editingCaret, composing: true })).toBe("contain");
  });

  it("an editor that owns its keys keeps Enter and Escape for itself", () => {
    const picker: ValueSlotKeyState = { editing: true, keys: "editor", composing: false };
    expect(valueSlotIntent({ key: "Enter" }, picker)).toBe("contain");
    expect(valueSlotIntent({ key: "Escape" }, picker)).toBe("contain");
  });
});
