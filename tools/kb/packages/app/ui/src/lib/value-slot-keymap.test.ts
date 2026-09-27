import { describe, expect, it } from "vitest";
import { valueSlotIntent, type ValueSlotKeyState } from "@/lib/value-slot-keymap";

const editingCaret: ValueSlotKeyState = {
  editing: true,
  keys: "slot",
  composing: false,
  canFollow: false,
  toggles: false,
  addsOnEnter: () => false,
  caretAtStart: () => false,
  caretAtEnd: () => false,
  textEmpty: () => false,
};
const atRest: ValueSlotKeyState = { ...editingCaret, editing: false };

describe("a value slot at rest", () => {
  it("moves with the arrows and Tab, through the values and on to the rows", () => {
    expect(valueSlotIntent({ key: "ArrowDown" }, atRest)).toBe("next");
    expect(valueSlotIntent({ key: "ArrowUp" }, atRest)).toBe("previous");
    expect(valueSlotIntent({ key: "Tab" }, atRest)).toBe("next");
    expect(valueSlotIntent({ key: "Tab", shiftKey: true }, atRest)).toBe("previous");
  });

  it("opens on Enter, starts typing on a printable key, and a toggle flips on Space", () => {
    expect(valueSlotIntent({ key: "Enter" }, atRest)).toBe("edit");
    expect(valueSlotIntent({ key: "F2" }, atRest)).toBe("edit");
    expect(valueSlotIntent({ key: "x" }, atRest)).toBe("type");
    expect(valueSlotIntent({ key: " " }, { ...atRest, toggles: true })).toBe("edit");
  });

  it("takes the value out on Backspace or Delete, and goes back to the row on Escape", () => {
    expect(valueSlotIntent({ key: "Backspace" }, atRest)).toBe("remove");
    expect(valueSlotIntent({ key: "Delete" }, atRest)).toBe("remove");
    expect(valueSlotIntent({ key: "Escape" }, atRest)).toBe("leave");
  });

  it("leaves modified keys to the app, ⌘Enter aside when the value points somewhere", () => {
    expect(valueSlotIntent({ key: "k", metaKey: true }, atRest)).toBeNull();
    expect(valueSlotIntent({ key: "Enter", metaKey: true }, atRest)).toBeNull();
    expect(valueSlotIntent({ key: "Enter", ctrlKey: true }, { ...atRest, canFollow: true })).toBe(
      "follow",
    );
  });
});

describe("a value slot while its caret editor is open", () => {
  it("commits on Enter and reverts on Escape", () => {
    expect(valueSlotIntent({ key: "Enter" }, editingCaret)).toBe("commit");
    expect(valueSlotIntent({ key: "Escape" }, editingCaret)).toBe("cancel");
  });

  it("Shift+Enter is a line break inside the value", () => {
    expect(valueSlotIntent({ key: "Enter", shiftKey: true }, editingCaret)).toBe("softBreak");
  });

  it("Enter at the end of a many-valued field's value adds the next one", () => {
    expect(valueSlotIntent({ key: "Enter" }, { ...editingCaret, addsOnEnter: () => true })).toBe(
      "commitAndAdd",
    );
  });

  it("Tab, and an arrow off the text's edge, keep the edit and move on", () => {
    expect(valueSlotIntent({ key: "Tab" }, editingCaret)).toBe("commitAndNext");
    expect(valueSlotIntent({ key: "Tab", shiftKey: true }, editingCaret)).toBe("commitAndPrevious");
    const edges = { ...editingCaret, caretAtStart: () => true, caretAtEnd: () => true };
    expect(valueSlotIntent({ key: "ArrowDown" }, edges)).toBe("commitAndNext");
    expect(valueSlotIntent({ key: "ArrowUp" }, edges)).toBe("commitAndPrevious");
    // Inside the text the arrows are the caret's.
    expect(valueSlotIntent({ key: "ArrowDown" }, editingCaret)).toBe("contain");
  });

  it("Backspace in an emptied value takes it out; elsewhere it is the text's", () => {
    expect(valueSlotIntent({ key: "Backspace" }, { ...editingCaret, textEmpty: () => true })).toBe(
      "removeEmpty",
    );
    expect(valueSlotIntent({ key: "Backspace" }, editingCaret)).toBe("contain");
  });

  it("every other key an editing slot receives stays inside it", () => {
    expect(valueSlotIntent({ key: "a" }, editingCaret)).toBe("contain");
  });

  it("an IME composition keeps its Enter", () => {
    expect(valueSlotIntent({ key: "Enter" }, { ...editingCaret, composing: true })).toBe("contain");
  });

  it("an editor that owns its keys keeps them, ⌘Enter aside", () => {
    const picker: ValueSlotKeyState = { ...editingCaret, keys: "editor", canFollow: true };
    expect(valueSlotIntent({ key: "Enter" }, picker)).toBe("contain");
    expect(valueSlotIntent({ key: "Escape" }, picker)).toBe("contain");
    expect(valueSlotIntent({ key: "ArrowDown" }, picker)).toBe("contain");
    expect(valueSlotIntent({ key: "Enter", metaKey: true }, picker)).toBe("follow");
  });
});
