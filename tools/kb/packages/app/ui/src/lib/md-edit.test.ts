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
import { isTextNode } from "@/lib/dom";
import {
  getCaretSerializedOffset,
  isCanonicalInline,
  readInlineInput,
  renderInlineMarkdown,
  revealMarkupAtSelection,
  serializeEditable,
  setCaretSerializedOffset,
} from "@/lib/md-edit";
import { InlineMarkdown } from "@/components/ui/md-view";

/** No graph behind the text: every reference keeps the default link colour. */
const PLAIN_INK = (): string | null => null;

/** One tagged target, `n.tagged`, inked red. */
const TAGGED_RED = (id: string): string | null => (id === "n.tagged" ? "red" : null);

/** The ink each reference under `root` carries, in order. */
function refInks(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>("a.kb-md-ref")].map((a) =>
    a.style.getPropertyValue("--kb-ref-ink"),
  );
}

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
    renderInlineMarkdown(el, "hello world", PLAIN_INK);
    expect(serializeEditable(el)).toBe("hello world");
  });

  it("renders refs as atomic pills and serializes back exactly", () => {
    const el = makeEl();
    const text = "see [[n.root-a|Ship kb]] and [[n.root-b]] end";
    renderInlineMarkdown(el, text, PLAIN_INK);
    // Pills are non-editable links carrying the full token.
    const pills = el.querySelectorAll("[data-kb-ref]");
    expect(pills.length).toBe(2);
    const pill = present(pills.item(0), "first pill");
    expect(pill.getAttribute("contenteditable")).toBe("false");
    expect(pill.getAttribute("data-kb-ref")).toBe("[[n.root-a|Ship kb]]");
    expect(pill.textContent).toBe("Ship kb"); // label only — no ULID
    expect(serializeEditable(el)).toBe(text);
  });
});

describe("md-edit caret offsets", () => {
  it("counts pill tokens at full serialized length (D06)", () => {
    const el = makeEl();
    renderInlineMarkdown(el, "[[n.root-a|Ship kb]] tail", PLAIN_INK);
    const pill = present(el.querySelector("[data-kb-ref]"), "ref pill");
    const tail = present(pill.nextSibling, "pill tail");
    selectAt(el, tail, 3); // mid "tail" → after token
    expect(getCaretSerializedOffset(el)).toBe("[[n.root-a|Ship kb]]".length + 3);
  });

  it("places the caret by serialized offset skipping over pills", () => {
    const el = makeEl();
    const text = "pre [[n.a|L]] post";
    renderInlineMarkdown(el, text, PLAIN_INK);
    setCaretSerializedOffset(el, text.length);
    const sel = present(window.getSelection(), "selection");
    expect(sel.rangeCount).toBe(1);
    expect(getCaretSerializedOffset(el)).toBe(text.length);
  });

  it("clamps offsets past the end of content", () => {
    const el = makeEl();
    renderInlineMarkdown(el, "abc", PLAIN_INK);
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
    "ends in a break\n",
  ];

  it("reads every text back byte for byte", () => {
    for (const text of corpus) {
      const el = makeEl();
      renderInlineMarkdown(el, text, PLAIN_INK);
      expect(serializeEditable(el)).toBe(text);
    }
  });

  it("keeps a segment's markup beside its formatted element, hidden by class", () => {
    const el = makeEl();
    renderInlineMarkdown(el, "a **b** [x](https://ex.test)", PLAIN_INK);
    const seg = present(el.querySelector(".kb-md-seg"), "bold segment");
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
    renderInlineMarkdown(el, "`[[n.a|in code]]` [[n.b|Ship]]", PLAIN_INK);
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
      renderInlineMarkdown(el, text, PLAIN_INK);
      const probe = makeEl();
      probe.innerHTML = renderToStaticMarkup(
        createElement(InlineMarkdown, { text, ink: PLAIN_INK }),
      );
      expect(el.innerHTML).toBe(probe.innerHTML);
    }
  });

  it("inks a reference by its target, on both builds alike, and leaves links alone", () => {
    const ink = TAGGED_RED;
    const text = "[[n.tagged|Tagged]] [[n.plain|Plain]] [x](https://ex.test) https://ex.test";
    const el = makeEl();
    renderInlineMarkdown(el, text, ink);
    const [tagged, plain] = [...el.querySelectorAll("a.kb-md-ref")];
    expect((tagged as HTMLElement | undefined)?.style.getPropertyValue("--kb-ref-ink")).toBe("red");
    expect(plain?.hasAttribute("style")).toBe(false);
    expect([...el.querySelectorAll("a.kb-md-link")].map((a) => a.hasAttribute("style"))).toEqual([
      false,
      false,
    ]);
    // Inking is part of the tree, so it reads back as the same text.
    expect(serializeEditable(el)).toBe(text);
    expect(isCanonicalInline(el, text, ink)).toBe(true);
    const probe = makeEl();
    probe.innerHTML = renderToStaticMarkup(createElement(InlineMarkdown, { text, ink }));
    expect(refInks(probe)).toEqual(refInks(el));
  });
});

const revealed = (el: HTMLElement) =>
  [...el.querySelectorAll(".kb-md-seg[data-md-reveal]")].map((s) => s.textContent);

/** Where the caret rests, as `text@offset`. */
function where(): string {
  const range = present(window.getSelection(), "selection").getRangeAt(0);
  return `${range.startContainer.textContent}@${range.startOffset}`;
}

describe("editing in place", () => {
  function mounted(text: string): HTMLDivElement {
    const el = makeEl();
    document.body.appendChild(el);
    renderInlineMarkdown(el, text, PLAIN_INK);
    return el;
  }

  it("reveals the markup of the segment the caret touches, at either edge", () => {
    const el = mounted("a **b** c `d`");
    for (const [at, shown] of [
      [0, []],
      [2, ["**b**"]],
      [5, ["**b**"]],
      [7, ["**b**"]],
      [8, []],
      [10, ["`d`"]],
    ] as const) {
      setCaretSerializedOffset(el, at);
      revealMarkupAtSelection(el);
      expect(revealed(el)).toEqual(shown);
    }
    window.getSelection()?.removeAllRanges();
    revealMarkupAtSelection(el);
    expect(revealed(el)).toEqual([]);
    el.remove();
  });

  it("reveals every segment a selection spans", () => {
    const el = mounted("**a** and *b* and `c`");
    const range = document.createRange();
    range.setStart(present(el.querySelector("strong")?.firstChild, "a"), 0);
    range.setEnd(present(el.querySelector("em")?.firstChild, "b"), 1);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    revealMarkupAtSelection(el);
    expect(revealed(el)).toEqual(["**a**", "*b*"]);
    el.remove();
  });

  it("is canonical after typing inside a segment, not after closing one", () => {
    const el = mounted("a **b");
    const tail = present(el.lastChild, "text");
    // The browser types into the text node it holds the caret in.
    if (isTextNode(tail)) tail.data += "**";
    expect(serializeEditable(el)).toBe("a **b**");
    expect(isCanonicalInline(el, "a **b**", PLAIN_INK)).toBe(false);
    renderInlineMarkdown(el, "a **b**", PLAIN_INK);
    expect(isCanonicalInline(el, "a **b**", PLAIN_INK)).toBe(true);
    const strong = present(el.querySelector("strong")?.firstChild, "bold text");
    if (isTextNode(strong)) strong.data = "bc";
    expect(isCanonicalInline(el, serializeEditable(el), PLAIN_INK)).toBe(true);
    el.remove();
  });

  it("reads typing back, rebuilding the tree only when the typing changed its meaning", () => {
    const el = mounted("a **b");
    const tail = present(el.lastChild, "text");
    if (isTextNode(tail)) tail.data += "**";
    setCaretSerializedOffset(el, 7);
    expect(el.querySelector("strong")).toBeNull();
    // Closing the `**` changed what the text means: the tree follows it.
    expect(readInlineInput(el, PLAIN_INK)).toEqual({ text: "a **b**", caret: 7 });
    expect(el.querySelector("strong")?.textContent).toBe("b");
    // Typing inside the segment does not: the browser's own nodes stay.
    const strong = present(el.querySelector("strong"), "bold");
    const inner = present(strong.firstChild, "bold text");
    if (isTextNode(inner)) inner.data = "bc";
    expect(readInlineInput(el, PLAIN_INK).text).toBe("a **bc**");
    expect(el.querySelector("strong")).toBe(strong);
    el.remove();
  });

  it("ignores which segments are revealed and the host element's own attributes", () => {
    const el = mounted("**b**");
    el.setAttribute("contenteditable", "true");
    el.className = "kb-text";
    setCaretSerializedOffset(el, 1);
    revealMarkupAtSelection(el);
    expect(revealed(el)).toEqual(["**b**"]);
    expect(isCanonicalInline(el, "**b**", PLAIN_INK)).toBe(true);
    el.remove();
  });

  it("rests a caret beside a pill, in its parent, never inside it", () => {
    const el = mounted("[[n.a|A]][[n.b|B]]");
    const inParent = () => {
      const range = present(window.getSelection(), "selection").getRangeAt(0);
      return [range.startContainer === el, range.startOffset];
    };
    setCaretSerializedOffset(el, 0);
    expect(inParent()).toEqual([true, 0]);
    setCaretSerializedOffset(el, "[[n.a|A]]".length);
    expect(inParent()).toEqual([true, 1]);
    setCaretSerializedOffset(el, 99);
    expect(inParent()).toEqual([true, 2]);
    expect(getCaretSerializedOffset(el)).toBe("[[n.a|A]][[n.b|B]]".length);
    el.remove();
  });

  it("rests a boundary caret outside the hidden markup", () => {
    const el = mounted("a **b** c");
    setCaretSerializedOffset(el, 2);
    expect(where()).toBe("a @2");
    setCaretSerializedOffset(el, 4);
    expect(where()).toBe("b@0");
    setCaretSerializedOffset(el, 5);
    expect(where()).toBe("b@1");
    setCaretSerializedOffset(el, 7);
    expect(where()).toBe(" c@0");
    el.remove();
  });

  it("puts a caret at a segment's edge where typing extends it by source", () => {
    const el = mounted("**b**");
    // Offset 2 sits after the opening marks: the next character typed is bold.
    setCaretSerializedOffset(el, 2);
    expect(getCaretSerializedOffset(el)).toBe(2);
    setCaretSerializedOffset(el, 5);
    expect(getCaretSerializedOffset(el)).toBe(5);
    el.remove();
  });
});
