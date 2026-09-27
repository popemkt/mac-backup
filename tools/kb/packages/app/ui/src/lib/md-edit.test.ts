/**
 * r1 D06/D16 — serialized caret offsets and atomic ref pills.
 * The active editor must never expose raw ULIDs to the caret while the
 * stored text stays canonical markdown.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { present } from "@kb/model";
import {
  findRefSpans,
  getCaretSerializedOffset,
  renderEditableContent,
  renderInlineMarkdown,
  serializeEditable,
  setCaretSerializedOffset,
} from "@/lib/md-edit";
import { InlineMarkdown } from "@/components/ui/md-view";

beforeAll(() => {
  const dom = new Window();
  const g = globalThis as Record<string, unknown>;
  g.window = dom;
  g.document = dom.document;
  g.Node = dom.Node;
  g.HTMLElement = dom.HTMLElement;
  if (!("NodeFilter" in g)) {
    g.NodeFilter = dom.NodeFilter;
  }
});

function makeEl(): HTMLDivElement {
  return document.createElement("div");
}

function selectAt(_el: HTMLElement, node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
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
    const pill = present(pills.item(0), "first pill");
    expect(pill.getAttribute("contenteditable")).toBe("false");
    expect(pill.getAttribute("data-kb-ref")).toBe("[[n.root-a|Ship kb]]");
    expect(pill.textContent).toBe("Ship kb"); // label only — no ULID
    expect(serializeEditable(el)).toBe(text);
  });

  it("finds ordered ref spans with ids/labels", () => {
    const spans = findRefSpans("a [[id1|x]] b [[id2]] c");
    expect(spans.map((s) => s.id)).toEqual(["id1", "id2"]);
    const first = present(spans.at(0), "first span");
    const second = present(spans.at(1), "second span");
    expect(second.label).toBe("id2");
    expect(first.index).toBe(2);
  });
});

describe("md-edit caret offsets", () => {
  it("counts pill tokens at full serialized length (D06)", () => {
    const el = makeEl();
    renderEditableContent(el, "[[n.root-a|Ship kb]] tail");
    const pill = present(el.querySelector("[data-kb-ref]"), "ref pill");
    const tail = present(pill.nextSibling, "pill tail");
    selectAt(el, tail, 3); // mid "tail" → after token
    expect(getCaretSerializedOffset(el)).toBe("[[n.root-a|Ship kb]]".length + 3);
  });

  it("places the caret by serialized offset skipping over pills", () => {
    const el = makeEl();
    const text = "pre [[n.a|L]] post";
    renderEditableContent(el, text);
    setCaretSerializedOffset(el, text.length);
    const sel = present(window.getSelection(), "selection");
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

describe("renderInlineMarkdown — one DOM for reading and editing", () => {
  const corpus = [
    "plain",
    "**b** and *i* plus `c`",
    "__b__ ***both*** snake_case_name",
    "see [[n.root-a|Ship]] ok [[sys.tag]]",
    "[docs](https://ex.test/a_(b)) and [bad](javascript:x)",
    "![shot](assets/a.png) and ![v](assets/v.mp4)",
    "unmatched ** and ` and [[",
    "line one\nline **two**",
  ];

  it("reads every text back byte for byte", () => {
    for (const text of corpus) {
      const el = makeEl();
      renderInlineMarkdown(el, text);
      expect(serializeEditable(el)).toBe(text);
    }
  });

  it("keeps a segment's markup beside its formatted element, hidden by class", () => {
    const el = makeEl();
    renderInlineMarkdown(el, "a **b** [x](https://ex.test)");
    const seg = present(el.querySelector(".kb-md-seg"), "bold segment");
    expect(seg.getAttribute("data-md-from")).toBe("2");
    expect(seg.getAttribute("data-md-to")).toBe("7");
    expect([...seg.childNodes].map((n) => n.textContent)).toEqual(["**", "b", "**"]);
    expect(present(seg.querySelector("strong"), "strong").textContent).toBe("b");
    expect([...el.querySelectorAll(".kb-md-mark")].map((m) => m.textContent)).toEqual([
      "**",
      "**",
      "[",
      "](https://ex.test)",
    ]);
    expect(present(el.querySelector("a.kb-md-link"), "link").textContent).toBe("x");
  });

  it("renders a reference as one atomic link carrying its token", () => {
    const el = makeEl();
    renderInlineMarkdown(el, "`[[n.a|in code]]` [[n.b|Ship]]");
    const refs = el.querySelectorAll("a.kb-md-ref");
    // The one grammar: a ref inside code is code, not a ref.
    expect(refs.length).toBe(1);
    const ref = present(refs.item(0), "ref");
    expect(ref.getAttribute("contenteditable")).toBe("false");
    expect(ref.getAttribute("data-kb-ref")).toBe("[[n.b|Ship]]");
    expect(ref.getAttribute("data-kb-ref-id")).toBe("n.b");
    expect(ref.textContent).toBe("Ship");
  });

  it("builds the same tree React renders (InlineMarkdown)", () => {
    for (const text of corpus) {
      const el = makeEl();
      renderInlineMarkdown(el, text);
      const probe = makeEl();
      probe.innerHTML = renderToStaticMarkup(createElement(InlineMarkdown, { text }));
      expect(el.innerHTML).toBe(probe.innerHTML);
    }
  });
});
