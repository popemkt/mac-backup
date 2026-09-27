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
import { isElementNode, isTextNode } from "@/lib/dom";
import {
  assetSrcUrl,
  inlineSpanSource,
  isSafeHref,
  parseInlineSource,
  type InlineSeg,
  type InlineSpan,
} from "@/lib/md-inline";
import { textOr } from "@/lib/text";
export const KB_REF_ATTR = "data-kb-ref";
/** The id a rendered reference points at, read by click routing. */
export const KB_REF_ID_ATTR = "data-kb-ref-id";

/** Complete wiki-link token: [[id]] or [[id|label]]. */
const REF_TOKEN = /\[\[([^\][|]+)(?:\|([^\][]*))?\]\]/g;

export interface RefSpan {
  token: string;
  id: string;
  label: string;
  index: number;
}

/** Ordered reference tokens in a serialized text (for tests + tooling). */
export function findRefSpans(text: string): RefSpan[] {
  const out: RefSpan[] = [];
  for (const m of text.matchAll(REF_TOKEN)) {
    const [, target] = m;
    if (target === undefined) continue;
    const id = target.trim();
    const label = textOr(m[2]?.trim(), id);
    out.push({ token: m[0], id, label, index: m.index });
  }
  return out;
}

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

/** A formatted segment's wrapper, carrying the source range it spans. */
const INLINE_SEG_CLASS = "kb-md-seg";
const INLINE_SEG_FROM = "data-md-from";
const INLINE_SEG_TO = "data-md-to";

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

function spanNode(span: InlineSpan, from: number, to: number): InlineNode {
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
    { class: INLINE_SEG_CLASS, [INLINE_SEG_FROM]: String(from), [INLINE_SEG_TO]: String(to) },
    ...mark(span.open),
    contentNode(seg),
    ...mark(span.close),
  );
}

/** `text`'s inline element tree: every source character is in it (see the module doc). */
export function inlineNodes(text: string): InlineNode[] {
  const out: InlineNode[] = [];
  let at = 0;
  for (const span of parseInlineSource(text)) {
    const to = at + inlineSpanSource(span).length;
    if (to > at) out.push(spanNode(span, at, to));
    at = to;
  }
  return out;
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

/** Rebuild the editor DOM: text nodes + atomic ref pills. Idempotent. */
export function renderEditableContent(el: HTMLElement, text: string): void {
  el.textContent = "";
  let last = 0;
  for (const span of findRefSpans(text)) {
    const before = text.slice(last, span.index);
    if (before) el.appendChild(document.createTextNode(before));
    const pill = document.createElement("span");
    pill.setAttribute("contenteditable", "false");
    pill.setAttribute(KB_REF_ATTR, span.token);
    pill.setAttribute("class", "kb-edit-ref");
    pill.textContent = span.label;
    el.appendChild(pill);
    last = span.index + span.token.length;
  }
  const rest = text.slice(last);
  if (rest) el.appendChild(document.createTextNode(rest));
}

function serializeNode(node: Node): string {
  if (isTextNode(node)) return node.data;
  if (isElementNode(node)) {
    const token = node.getAttribute(KB_REF_ATTR);
    if (token !== null) return token;
    if (node.tagName === "BR") return "\n";
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
  for (const child of Array.from(el.childNodes)) measureUpTo(child, state);
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

function placeInTextNode(tn: Text, _local: number, remaining: { n: number }): boolean {
  const len = tn.data.length;
  if (remaining.n <= len) return true;
  remaining.n -= len;
  return false;
}

/** Place the caret at a serialized offset, skipping over pills. */
export function setCaretSerializedOffset(el: HTMLElement, pos: number): void {
  const remaining = { n: Math.max(0, pos) };
  // A holder, not a `let`: `visit` writes it, and control-flow analysis
  // cannot see through the closure.
  const state = { placed: false };

  const visit = (node: Node): boolean => {
    if (state.placed) return true;
    if (isTextNode(node)) {
      if (placeInTextNode(node, remaining.n, remaining)) {
        selectRange(node, Math.min(remaining.n, node.data.length));
        state.placed = true;
        return true;
      }
      return false;
    }
    if (isElementNode(node)) {
      if (node.getAttribute(KB_REF_ATTR) !== null) {
        remaining.n -= tokenLengthOf(node);
        return false;
      }
      for (const kid of Array.from(node.childNodes)) {
        if (visit(kid)) return true;
      }
      return false;
    }
    return false;
  };

  for (const child of Array.from(el.childNodes)) {
    if (visit(child)) break;
  }

  if (!state.placed) {
    // Past the end: park the caret after the last content.
    const lastText = lastDescendantText(el);
    if (lastText) selectRange(lastText, lastText.data.length);
  }
}

function selectRange(tn: Text, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(tn, offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** `NodeFilter.SHOW_TEXT` — the global is not present in every test DOM. */
const SHOW_TEXT = 0x4;

function lastDescendantText(el: HTMLElement): Text | null {
  const walker = document.createTreeWalker(el, SHOW_TEXT);
  let last: Text | null = null;
  for (let cur = walker.nextNode(); cur !== null; cur = walker.nextNode()) {
    if (isTextNode(cur)) last = cur;
  }
  return last;
}
