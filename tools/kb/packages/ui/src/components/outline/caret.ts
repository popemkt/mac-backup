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

/** Text mutations that can map a serialized markdown offset. */
export type CaretStep =
  | { kind: "updateText"; before: string; after: string }
  | { kind: "split"; offset: number; side: "left" | "right" }
  | { kind: "merge"; leftLength: number; source: "left" | "right" };

/**
 * Map an offset through the small text-operation vocabulary used by the
 * outline. Insertions at the boundary are biased to the edited content;
 * callers therefore retain their intended character rather than merely
 * clamping to a plausible position after a structural write.
 */
export function mapOffset(step: CaretStep, offset: number): number {
  const at = Math.max(0, offset);
  switch (step.kind) {
    case "updateText": {
      if (step.before === step.after) return at;
      let prefix = 0;
      const shared = Math.min(step.before.length, step.after.length);
      while (prefix < shared && step.before[prefix] === step.after[prefix]) prefix += 1;
      let beforeSuffix = step.before.length;
      let afterSuffix = step.after.length;
      while (
        beforeSuffix > prefix &&
        afterSuffix > prefix &&
        step.before[beforeSuffix - 1] === step.after[afterSuffix - 1]
      ) {
        beforeSuffix -= 1;
        afterSuffix -= 1;
      }
      if (at <= prefix) return at;
      if (at >= beforeSuffix) return at + (afterSuffix - beforeSuffix);
      return afterSuffix;
    }
    case "split":
      return step.side === "left" ? Math.min(at, step.offset) : Math.max(0, at - step.offset);
    case "merge":
      return step.source === "left" ? at : step.leftLength + at;
  }
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
  return geometry.onLastLine ? { kind: "cross", direction: 1, x: geometry.x } : { kind: "within" };
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
    const targetTop = line === "first" ? Math.min(...rects) : Math.max(...rects);

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

/** Serialized offset under viewport point (clientX/clientY). Null when no caret. F16. */
export function offsetFromPoint(el: HTMLElement, clientX: number, clientY: number): number | null {
  try {
    let range: Range | null = null;
    const anyDoc = document as unknown as Record<string, unknown>;
    if (typeof anyDoc["caretRangeFromPoint"] === "function") {
      range = (anyDoc["caretRangeFromPoint"] as (x: number, y: number) => Range | null)(
        clientX,
        clientY,
      );
    } else if (
      typeof (
        document as unknown as {
          caretPositionFromPoint?: (
            x: number,
            y: number,
          ) => { offsetNode: Node; offset: number } | null;
        }
      ).caretPositionFromPoint === "function"
    ) {
      const pos = (
        document as unknown as {
          caretPositionFromPoint: (
            x: number,
            y: number,
          ) => { offsetNode: Node; offset: number } | null;
        }
      ).caretPositionFromPoint!(clientX, clientY);
      if (pos) {
        const r = document.createRange();
        r.setStart(pos.offsetNode, pos.offset);
        r.collapse(true);
        range = r;
      }
    }
    if (!range || !el.contains(range.startContainer)) return null;
    // Measure serialized offset up to range start
    let total = 0;
    let done = false;
    const measure = (node: Node): void => {
      if (done) return;
      if (node === range!.startContainer) {
        if (node.nodeType === Node.TEXT_NODE) {
          total += Math.min(range!.startOffset, node.textContent?.length ?? 0);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const hel = node as HTMLElement;
          const token = hel.getAttribute(KB_REF_ATTR);
          if (token !== null) {
            total += range!.startOffset > 0 ? token.length : 0;
          } else {
            const kids = Array.from(hel.childNodes).slice(0, range!.startOffset);
            for (const kid of kids) measure(kid);
          }
        }
        done = true;
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        total += node.textContent?.length ?? 0;
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const hel = node as HTMLElement;
        const token = hel.getAttribute(KB_REF_ATTR);
        if (token !== null) {
          total += token.length;
          return;
        }
        for (const kid of Array.from(hel.childNodes)) measure(kid);
      }
    };
    for (const child of Array.from(el.childNodes)) {
      measure(child);
      if (done) break;
    }
    return done ? total : null;
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
