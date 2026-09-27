/**
 * Node text's DOM model: one element tree for inline markdown, whether it is
 * being read or edited (r1 D16).
 *
 * {@link renderInlineMarkdown} builds it from the stored string, and every
 * character of that string is in it: a formatted segment keeps its markup as
 * `.kb-md-mark` text beside the formatted element (hidden until revealed), so
 * {@link serializeEditable} reads the string straight back and a caret offset
 * into the DOM is an offset into the string. The two exceptions are atomic:
 * a reference renders as a non-editable link carrying its whole token, so a
 * raw ULID never faces the caret, and a media embed's element holds no text.
 */
import type { MouseEvent as ReactMouseEvent } from "react";
import { asElement, isElementNode, isTextNode } from "@/lib/dom";
import {
  assetSrcUrl,
  inlineSpanSource,
  isSafeHref,
  parseInlineSource,
  type InlineSeg,
  type InlineSpan,
} from "@/lib/md-inline";
export const KB_REF_ATTR = "data-kb-ref";
/** The id a rendered reference points at, read by click routing. */
const KB_REF_ID_ATTR = "data-kb-ref-id";

/**
 * The classes inline markdown paints text with. Exported so the contrast
 * guard measures the classes actually written (`design-systems.test.ts`).
 */
export const INLINE_TEXT_CLASSES = {
  code: "kb-md-code",
  link: "kb-md-link",
  ref: "kb-md-ref",
  mark: "kb-md-mark",
} as const;

/** The line box after a trailing newline: layout only, it reads back as nothing. */
const TRAILING_BREAK_ATTR = "data-kb-trailing-break";

/** A formatted segment's wrapper: its marks and its formatted element. */
const INLINE_SEG_CLASS = "kb-md-seg";

/**
 * One node of inline markdown's element tree: text, or an element named by
 * its DOM tag and attributes. This is the one description of what node text
 * renders as; {@link renderInlineMarkdown} builds it as live DOM and
 * `InlineMarkdown` (components/ui/md-view.tsx) as React elements, and
 * neither decides anything about markdown.
 */
export type InlineNode =
  | string
  | { tag: string; attrs: Readonly<Record<string, string>>; children: readonly InlineNode[] };

function h(
  tag: string,
  attrs: Readonly<Record<string, string>>,
  ...children: InlineNode[]
): InlineNode {
  return { tag, attrs, children };
}

const mark = (source: string): InlineNode[] =>
  source ? [h("span", { class: INLINE_TEXT_CLASSES.mark }, source)] : [];

function mediaNode(seg: Extract<InlineSeg, { t: "media" }>): InlineNode {
  const src = assetSrcUrl(seg.href);
  const common = { src, contenteditable: "false" };
  if (seg.kind === "image") {
    return h("img", {
      ...common,
      class: "kb-md-media kb-md-media-img",
      alt: seg.alt,
      loading: "lazy",
    });
  }
  // No fallback text child: it would read back as part of the source.
  return h(seg.kind, {
    ...common,
    class: `kb-md-media kb-md-media-${seg.kind}`,
    "aria-label": seg.alt,
    controls: "",
    preload: "metadata",
  });
}

/** The element a formatted segment renders as, between its marks. */
function contentNode(seg: Exclude<InlineSeg, { t: "text" } | { t: "ref" }>): InlineNode {
  switch (seg.t) {
    case "bold":
      return h("strong", {}, seg.v);
    case "italic":
      return h("em", {}, seg.v);
    case "code":
      return h("code", { class: INLINE_TEXT_CLASSES.code }, seg.v);
    case "link":
      // Defense in depth: the parser already filters unsafe protocols.
      return isSafeHref(seg.href)
        ? h(
            "a",
            {
              class: INLINE_TEXT_CLASSES.link,
              href: seg.href,
              target: "_blank",
              rel: "noreferrer",
            },
            seg.label,
          )
        : h("span", {}, seg.label);
    case "media":
      return mediaNode(seg);
    default: {
      const unhandled: never = seg;
      throw new Error(`unhandled inline segment: ${JSON.stringify(unhandled)}`);
    }
  }
}

function spanNode(span: InlineSpan): InlineNode {
  const { seg } = span;
  if (seg.t === "text") return seg.v;
  if (seg.t === "ref") {
    // Atomic: the caret never enters it, and it reads back as its token.
    return h(
      "a",
      {
        class: INLINE_TEXT_CLASSES.ref,
        href: `#${seg.id}`,
        title: seg.id,
        contenteditable: "false",
        [KB_REF_ATTR]: span.open,
        [KB_REF_ID_ATTR]: seg.id,
      },
      seg.label,
    );
  }
  return h(
    "span",
    { class: INLINE_SEG_CLASS },
    ...mark(span.open),
    contentNode(seg),
    ...mark(span.close),
  );
}

/** `text`'s inline element tree: every source character is in it (see the module doc). */
export function inlineNodes(text: string): InlineNode[] {
  const nodes = parseInlineSource(text)
    .filter((span) => inlineSpanSource(span) !== "")
    .map(spanNode);
  // A trailing line break opens a line only if something follows it; this
  // gives that line its box, so a caret after the break has a place to be.
  return text.endsWith("\n") ? [...nodes, h("br", { [TRAILING_BREAK_ATTR]: "" })] : nodes;
}

function toDom(node: InlineNode): Node {
  if (typeof node === "string") return document.createTextNode(node);
  const element = document.createElement(node.tag);
  for (const [name, value] of Object.entries(node.attrs)) element.setAttribute(name, value);
  for (const child of node.children) element.appendChild(toDom(child));
  return element;
}

/**
 * Build `text`'s inline DOM into `el`, replacing what is there. Idempotent,
 * and the inverse of {@link serializeEditable}.
 */
export function renderInlineMarkdown(target: HTMLElement, text: string): void {
  target.replaceChildren(...inlineNodes(text).map(toDom));
}

/**
 * What a click inside rendered inline markdown does, decided by what it
 * landed on: a reference navigates through `onRefClick`, a link or a media
 * embed keeps the click to itself (the link opens, the player plays), and
 * anything else is not inline content's business. True when it was handled.
 *
 * Every surface that renders node text routes clicks through this, so a
 * reference is clicked the same way in a read-only list and in an outline row.
 */
export function routeInlineClick(
  e: ReactMouseEvent,
  onRefClick: (e: ReactMouseEvent, id: string) => void,
): boolean {
  const target = asElement(e.target);
  const id = target?.closest(`[${KB_REF_ID_ATTR}]`)?.getAttribute(KB_REF_ID_ATTR);
  if (id !== null && id !== undefined && id !== "") {
    onRefClick(e, id);
    return true;
  }
  if (target?.closest(`a.${INLINE_TEXT_CLASSES.link}, .kb-md-media`)) {
    e.stopPropagation();
    return true;
  }
  return false;
}

/** Set on a segment's wrapper while the selection touches it: its markup shows. */
const SEG_REVEAL = "data-md-reveal";

/** Two nodes' children are the same trees. */
function sameChildren(a: Node, b: Node): boolean {
  if (a.childNodes.length !== b.childNodes.length) return false;
  return Array.from(a.childNodes).every((child, i) => {
    const other = b.childNodes[i];
    return other !== undefined && sameTree(child, other);
  });
}

/** Two inline trees are the same, ignoring which segments are revealed. */
function sameTree(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (isTextNode(a)) return isTextNode(b) && a.data === b.data;
  if (isElementNode(a) && isElementNode(b)) {
    if (a.tagName !== b.tagName) return false;
    const attrs = (el: Element) =>
      el
        .getAttributeNames()
        .filter((n) => n !== SEG_REVEAL)
        .toSorted()
        .map((n) => `${n}=${el.getAttribute(n) ?? ""}`)
        .join("\n");
    if (attrs(a) !== attrs(b)) return false;
  }
  return sameChildren(a, b);
}

/**
 * Whether `el` already holds the tree {@link renderInlineMarkdown} builds for
 * `text`. Typing inside a segment keeps it; typing that opens or closes one
 * (the second `*` of `**`) does not, and the editor rebuilds.
 */
export function isCanonicalInline(el: HTMLElement, text: string): boolean {
  const probe = document.createElement("div");
  renderInlineMarkdown(probe, text);
  // The host element is the surface's; only what is inside it is the text.
  return sameChildren(el, probe);
}

/**
 * Reveal the markup of every formatted segment the selection touches — a
 * caret at either edge of `**b**` counts — and hide the rest. Both sides are
 * measured as serialized offsets, so a caret resting in a hidden mark and one
 * resting in the text beside it agree.
 */
export function revealMarkupAtSelection(el: HTMLElement): void {
  const sel = window.getSelection();
  const range = sel !== null && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  const inside = range !== null && el.contains(range.startContainer);
  const from = inside
    ? serializedOffsetOfBoundary(el, range.startContainer, range.startOffset)
    : null;
  const to = inside ? serializedOffsetOfBoundary(el, range.endContainer, range.endOffset) : null;
  for (const seg of Array.from(el.querySelectorAll(`.${INLINE_SEG_CLASS}`))) {
    const parent = seg.parentNode;
    const index = parent === null ? -1 : Array.from(parent.childNodes).indexOf(seg);
    const segFrom = parent === null ? null : serializedOffsetOfBoundary(el, parent, index);
    const segTo = parent === null ? null : serializedOffsetOfBoundary(el, parent, index + 1);
    const touched =
      from !== null &&
      to !== null &&
      segFrom !== null &&
      segTo !== null &&
      segFrom <= to &&
      from <= segTo;
    if (touched) seg.setAttribute(SEG_REVEAL, "");
    else seg.removeAttribute(SEG_REVEAL);
  }
}

function serializeNode(node: Node): string {
  if (isTextNode(node)) return node.data;
  if (isElementNode(node)) {
    const token = node.getAttribute(KB_REF_ATTR);
    if (token !== null) return token;
    if (node.tagName === "BR") return node.hasAttribute(TRAILING_BREAK_ATTR) ? "" : "\n";
    let out = "";
    for (const child of Array.from(node.childNodes)) out += serializeNode(child);
    return out;
  }
  return "";
}

/** Canonical markdown for the editor's current DOM. */
export function serializeEditable(el: HTMLElement): string {
  let out = "";
  for (const child of Array.from(el.childNodes)) out += serializeNode(child);
  return out;
}

interface MeasureState {
  target: Node | null;
  offset: number;
  done: boolean;
  total: number;
}

function tokenLengthOf(el: Element): number {
  return el.getAttribute(KB_REF_ATTR)?.length ?? 0;
}

function measureUpTo(node: Node, state: MeasureState): void {
  if (state.done) return;
  if (node === state.target) {
    if (isTextNode(node)) {
      state.total += Math.min(state.offset, node.data.length);
    } else if (isElementNode(node)) {
      const token = node.getAttribute(KB_REF_ATTR);
      if (token !== null) {
        // Boundary inside an atomic pill: clamp to token edges.
        state.total += state.offset > 0 ? token.length : 0;
      } else {
        const kids = Array.from(node.childNodes).slice(0, state.offset);
        for (const kid of kids) measureUpTo(kid, state);
      }
    }
    state.done = true;
    return;
  }
  if (isTextNode(node)) {
    state.total += node.data.length;
    return;
  }
  if (isElementNode(node)) {
    const token = node.getAttribute(KB_REF_ATTR);
    if (token !== null) {
      state.total += tokenLengthOf(node);
      return;
    }
    for (const kid of Array.from(node.childNodes)) measureUpTo(kid, state);
  }
}

/**
 * Character offset of the caret in the SERIALIZED string. Pills count as
 * their full token, so offsets align with stored node text (D06/D16).
 */
/**
 * Serialized offset of the DOM boundary (`container`, `offset`) inside `el`,
 * or null when the walk never reaches it. Pills count as their whole token,
 * so the result indexes the stored node text.
 */
export function serializedOffsetOfBoundary(
  el: HTMLElement,
  container: Node,
  offset: number,
): number | null {
  const state: MeasureState = { target: container, offset, done: false, total: 0 };
  // From `el` itself, so a boundary between its own children is reached too.
  measureUpTo(el, state);
  return state.done ? state.total : null;
}

export function getCaretSerializedOffset(el: HTMLElement | null | undefined): number {
  if (!el) return 0;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  const endContainer = range.endContainer;
  if (!el.contains(endContainer)) return 0;
  return (
    serializedOffsetOfBoundary(el, endContainer, range.endOffset) ?? serializeEditable(el).length
  );
}

function inMark(node: Text): boolean {
  return node.parentElement?.classList.contains(INLINE_TEXT_CLASSES.mark) === true;
}

/**
 * Place the caret at a serialized offset, skipping over pills.
 *
 * An offset on a boundary has several DOM positions — the end of one text
 * node and the start of the next — and where the caret rests decides where
 * typing lands. A position outside the hidden markup wins: typing then goes
 * into the text beside a segment or inside its formatting, never into its
 * `**`, which would cost a rebuild for nothing.
 */
export function setCaretSerializedOffset(el: HTMLElement, pos: number): void {
  const state = { remaining: Math.max(0, pos), stop: false };
  /** Every DOM position at the offset, in document order; `plain` is text outside markup. */
  const candidates: { container: Node; offset: number; plain: boolean }[] = [];

  const visit = (node: Node): void => {
    if (state.stop) return;
    if (isTextNode(node)) {
      const len = node.data.length;
      if (state.remaining > len) {
        state.remaining -= len;
        return;
      }
      candidates.push({ container: node, offset: state.remaining, plain: !inMark(node) });
      // Strictly inside this node: no other position is the same offset.
      if (state.remaining < len) state.stop = true;
      state.remaining = 0;
      return;
    }
    if (!isElementNode(node)) return;
    if (node.getAttribute(KB_REF_ATTR) === null) {
      for (const kid of Array.from(node.childNodes)) visit(kid);
      return;
    }
    // An atomic pill: the caret rests beside it, in its parent, never inside.
    const parent = node.parentNode;
    const index = parent === null ? 0 : Array.from(parent.childNodes).indexOf(node);
    if (candidates.length > 0 || state.remaining === 0) {
      if (parent !== null && candidates.length === 0) {
        candidates.push({ container: parent, offset: index, plain: false });
      }
      state.stop = true;
      return;
    }
    state.remaining = Math.max(0, state.remaining - tokenLengthOf(node));
    if (state.remaining === 0 && parent !== null) {
      candidates.push({ container: parent, offset: index + 1, plain: false });
    }
  };

  for (const child of Array.from(el.childNodes)) visit(child);

  const pick = candidates.find((c) => c.plain) ?? candidates[0];
  if (pick) selectRange(pick.container, pick.offset);
  // Past the end: park the caret after the last content.
  else selectRange(el, el.childNodes.length);
}

function selectRange(container: Node, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(container, offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}
