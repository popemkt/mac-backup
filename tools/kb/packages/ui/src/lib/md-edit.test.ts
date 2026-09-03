/**
 * r1 D06/D16 — serialized caret offsets and atomic ref pills.
 * The active editor must never expose raw ULIDs to the caret while the
 * stored text stays canonical markdown.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import {
  findRefSpans,
  getCaretSerializedOffset,
  renderEditableContent,
  serializeEditable,
  setCaretSerializedOffset,
} from "@/lib/md-edit";

beforeAll(() => {
  const dom = new Window();
  const g = globalThis as Record<string, unknown>;
  g.window = dom;
  g.document = dom.document;
  g.Node = dom.Node;
  g.HTMLElement = dom.HTMLElement;
  if (!("NodeFilter" in g)) {
    g.NodeFilter = dom.NodeFilter ?? { SHOW_TEXT: 4 };
  }
});

function makeEl(): HTMLDivElement {
  return document.createElement("div");
}

describe("md-edit serialization", () => {
  it("round-trips plain text", () => {
    const el = makeEl();
    renderEditableContent(el, "hello world");
    expect(serializeEditable(el)).toBe("hello world");
  });

  it("renders refs as atomic pills and serializes back exactly", () => {
    const el = makeEl();
    const text = "see [[n.root-a|Ship kb]] and [[n.root-b]] end";
    renderEditableContent(el, text);
    // Pills are non-editable spans carrying the full token.
    const pills = el.querySelectorAll("[data-kb-ref]");
    expect(pills.length).toBe(2);
    expect(pills[0]!.getAttribute("contenteditable")).toBe("false");
    expect(pills[0]!.getAttribute("data-kb-ref")).toBe("[[n.root-a|Ship kb]]");
    expect(pills[0]!.textContent).toBe("Ship kb"); // label only — no ULID
    expect(serializeEditable(el)).toBe(text);
  });

  it("finds ordered ref spans with ids/labels", () => {
    const spans = findRefSpans("a [[id1|x]] b [[id2]] c");
    expect(spans.map((s) => s.id)).toEqual(["id1", "id2"]);
    expect(spans[1]!.label).toBe("id2");
    expect(spans[0]!.index).toBe(2);
  });
});

describe("md-edit caret offsets", () => {
  function selectAt(_el: HTMLElement, node: Node, offset: number): void {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  it("counts pill tokens at full serialized length (D06)", () => {
    const el = makeEl();
    renderEditableContent(el, "[[n.root-a|Ship kb]] tail");
    const pill = el.querySelector("[data-kb-ref]")!;
    const tail = pill.nextSibling!;
    selectAt(el, tail, 3); // mid "tail" → after token
    expect(getCaretSerializedOffset(el)).toBe("[[n.root-a|Ship kb]]".length + 3);
  });

  it("places the caret by serialized offset skipping over pills", () => {
    const el = makeEl();
    const text = "pre [[n.a|L]] post";
    renderEditableContent(el, text);
    setCaretSerializedOffset(el, text.length);
    const sel = window.getSelection()!;
    expect(sel.rangeCount).toBe(1);
    expect(getCaretSerializedOffset(el)).toBe(text.length);
  });

  it("clamps offsets past the end of content", () => {
    const el = makeEl();
    renderEditableContent(el, "abc");
    setCaretSerializedOffset(el, 99);
    expect(getCaretSerializedOffset(el)).toBe(3);
  });

  it("returns 0 without a selection or detached root", () => {
    expect(getCaretSerializedOffset(null)).toBe(0);
    const el = makeEl(); // never in the document / no selection inside
    document.body.appendChild(el);
    window.getSelection()?.removeAllRanges();
    expect(getCaretSerializedOffset(el)).toBe(0);
    el.remove();
  });
});
