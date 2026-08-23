/**
 * DOM caret geometry for the outline editor (r1 D06/D10/D11).
 *
 * Layout-dependent probes degrade to permissive defaults in environments
 * without real layout (happy-dom / SSR): every predicate then reports the
 * caret at BOTH line extremes and x = null, so keyboard decisions fall
 * back to offset-based behaviour that is always safe.
 */
import { KB_REF_ATTR } from "@/lib/md-edit";

export interface CaretGeometry {
  /** Caret sits on the first rendered visual line of the element. */
  onFirstLine: boolean;
  /** Caret sits on the last rendered visual line of the element. */
  onLastLine: boolean;
  /** Viewport x of the caret (column preservation), null when unknown. */
  x: number | null;
}

const PERMISSIVE: CaretGeometry = {
  onFirstLine: true,
  onLastLine: true,
  x: null,
};

function uniqueTops(rects: DOMRectList | DOMRect[]): number[] {
  const tops: number[] = [];
  for (const r of Array.from(rects)) {
    if (!r || (r.width === 0 && r.height === 0)) continue;
    const top = Math.round(r.top);
    if (!tops.includes(top)) tops.push(top);
  }
  return tops;
}

function childIndexEndRange(el: HTMLElement, range: Range): Range {
  const after = range.cloneRange();
  after.selectNodeContents(el);
  after.setStart(range.startContainer, range.startOffset);
  return after;
}

/** Read first/last visual-line membership + caret x for the current selection. */
export function readCaretGeometry(el: HTMLElement): CaretGeometry {
  try {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return PERMISSIVE;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.endContainer)) return PERMISSIVE;

    const before = document.createRange();
    before.selectNodeContents(el);
    before.setEnd(range.endContainer, range.endOffset);
    const after = childIndexEndRange(el, range);

    const caretRects = range.getClientRects();
    let x: number | null = null;
    if (caretRects.length > 0) {
      const lastRect = caretRects[caretRects.length - 1]!;
      x = lastRect.left;
    }

    return {
      onFirstLine: uniqueTops(before.getClientRects()).length <= 1,
      onLastLine: uniqueTops(after.getClientRects()).length <= 1,
      x,
    };
  } catch {
    return PERMISSIVE;
  }
}

export type VerticalDirection = -1 | 1;

export type VerticalNavDecision =
  | { kind: "within" }
  | { kind: "cross"; direction: VerticalDirection; x: number | null };

/**
 * Pure vertical-arrow decision (D10). Crosses a row boundary only when the
 * caret is on the outermost visual line in the pressed direction — never on
 * naive character offsets.
 */
export function verticalArrowDecision(input: {
  key: "ArrowUp" | "ArrowDown";
  geometry: Pick<CaretGeometry, "onFirstLine" | "onLastLine" | "x">;
}): VerticalNavDecision {
  const { key, geometry } = input;
  if (key === "ArrowUp") {
    return geometry.onFirstLine
      ? { kind: "cross", direction: -1, x: geometry.x }
      : { kind: "within" };
  }
  return geometry.onLastLine
    ? { kind: "cross", direction: 1, x: geometry.x }
    : { kind: "within" };
}

/**
 * Serialized character offset in `el` whose caret lands closest to viewport
 * `x` on the requested visual line (D11 column preservation). Returns null
 * when layout information is unavailable — callers keep their fallback.
 */
export function nearestOffsetForX(
  el: HTMLElement,
  x: number,
  line: "first" | "last",
): number | null {
  try {
    const all = document.createRange();
    all.selectNodeContents(el);
    const rects = uniqueTops(all.getClientRects());
    if (rects.length === 0) return null;
    const targetTop =
      line === "first"
        ? Math.min(...rects)
        : Math.max(...rects);

    let best: { offset: number; dist: number } | null = null;
    let serialized = 0;

    const visit = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        const tn = node as Text;
        for (let i = 0; i <= tn.data.length; i++) {
          const r = charRect(tn, i);
          if (!r) continue;
          if (Math.round(r.top) !== targetTop) continue;
          const dist = Math.abs(r.left - x);
          if (!best || dist < best.dist) {
            best = { offset: serialized + i, dist };
          }
        }
        serialized += tn.data.length;
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const hel = node as HTMLElement;
        const token = hel.getAttribute(KB_REF_ATTR);
        if (token !== null) {
          const r = hel.getBoundingClientRect();
          if (r && Math.round(r.top) === targetTop) {
            const edges: Array<[number, number]> = [
              [serialized, r.left],
              [serialized + token.length, r.right],
            ];
            for (const [offset, left] of edges) {
              const dist = Math.abs(left - x);
              if (!best || dist < best.dist) best = { offset, dist };
            }
          }
          serialized += token.length;
          return;
        }
        for (const kid of Array.from(hel.childNodes)) visit(kid);
      }
    };

    for (const child of Array.from(el.childNodes)) visit(child);
    return best ? (best as { offset: number }).offset : null;
  } catch {
    return null;
  }
}

function charRect(tn: Text, index: number): DOMRect | null {
  try {
    const r = document.createRange();
    r.setStart(tn, index);
    r.setEnd(tn, index);
    const rects = r.getClientRects();
    return rects.length > 0 ? rects[0]! : null;
  } catch {
    return null;
  }
}
