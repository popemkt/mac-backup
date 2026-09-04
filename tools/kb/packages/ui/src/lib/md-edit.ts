/**
 * Active-editor content model (r1 D16).
 *
 * References (`[[id|label]]`) render inside the ACTIVE contentEditable as
 * atomic, non-editable pills — the raw 26-char ULID is never exposed to the
 * caret. Everything else stays plain text. Serialization is canonical
 * markdown, so the store keeps plain text; the pill layer is purely
 * presentational and rebuilt from the authoritative string.
 */
import { isElementNode, isTextNode } from "@/lib/dom";
import { textOr } from "@/lib/text";
export const KB_REF_ATTR = "data-kb-ref";

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
