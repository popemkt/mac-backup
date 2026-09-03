/**
 * Active-editor content model (r1 D16).
 *
 * References (`[[id|label]]`) render inside the ACTIVE contentEditable as
 * atomic, non-editable pills — the raw 26-char ULID is never exposed to the
 * caret. Everything else stays plain text. Serialization is canonical
 * markdown, so the store keeps plain text; the pill layer is purely
 * presentational and rebuilt from the authoritative string.
 */
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
    const id = m[1]!.trim();
    const label = m[2]?.trim() || id;
    out.push({ token: m[0], id, label, index: m.index ?? 0 });
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
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    const token = el.getAttribute(KB_REF_ATTR);
    if (token !== null) return token;
    if (el.tagName === "BR") return "\n";
    let out = "";
    for (const child of Array.from(el.childNodes)) out += serializeNode(child);
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

function tokenLengthOf(el: HTMLElement): number {
  return el.getAttribute(KB_REF_ATTR)?.length ?? 0;
}

function measureUpTo(node: Node, state: MeasureState): void {
  if (state.done) return;
  if (node === state.target) {
    if (node.nodeType === Node.TEXT_NODE) {
      state.total += Math.min(state.offset, node.textContent?.length ?? 0);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const token = el.getAttribute(KB_REF_ATTR);
      if (token !== null) {
        // Boundary inside an atomic pill: clamp to token edges.
        state.total += state.offset > 0 ? token.length : 0;
      } else {
        const kids = Array.from(el.childNodes).slice(0, state.offset);
        for (const kid of kids) measureUpTo(kid, state);
      }
    }
    state.done = true;
    return;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    state.total += node.textContent?.length ?? 0;
    return;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    const token = el.getAttribute(KB_REF_ATTR);
    if (token !== null) {
      state.total += tokenLengthOf(el);
      return;
    }
    for (const kid of Array.from(el.childNodes)) measureUpTo(kid, state);
  }
}

/**
 * Character offset of the caret in the SERIALIZED string. Pills count as
 * their full token, so offsets align with stored node text (D06/D16).
 */
export function getCaretSerializedOffset(el: HTMLElement | null | undefined): number {
  if (!el) return 0;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  const endContainer = range.endContainer;
  if (!el.contains(endContainer)) return 0;
  const state: MeasureState = {
    target: endContainer,
    offset: range.endOffset,
    done: false,
    total: 0,
  };
  for (const child of Array.from(el.childNodes)) measureUpTo(child, state);
  return state.done ? state.total : serializeEditable(el).length;
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
  let placed = false;

  const visit = (node: Node): boolean => {
    if (placed) return true;
    if (node.nodeType === Node.TEXT_NODE) {
      const tn = node as Text;
      if (placeInTextNode(tn, remaining.n, remaining)) {
        selectRange(tn, Math.min(remaining.n, tn.data.length));
        placed = true;
        return true;
      }
      return false;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const hel = node as HTMLElement;
      if (hel.getAttribute(KB_REF_ATTR) !== null) {
        remaining.n -= tokenLengthOf(hel);
        return false;
      }
      for (const kid of Array.from(hel.childNodes)) {
        if (visit(kid)) return true;
      }
      return false;
    }
    return false;
  };

  for (const child of Array.from(el.childNodes)) {
    if (visit(child)) break;
  }

  if (!placed) {
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

function lastDescendantText(el: HTMLElement): Text | null {
  const nf = (globalThis as unknown as Record<string, unknown>).NodeFilter as
    | { SHOW_TEXT: number }
    | undefined;
  const whatToShow = nf?.SHOW_TEXT ?? 4;
  const walker = document.createTreeWalker(el, whatToShow);
  let last: Text | null = null;
  let cur = walker.nextNode();
  while (cur) {
    last = cur as Text;
    cur = walker.nextNode();
  }
  return last;
}
