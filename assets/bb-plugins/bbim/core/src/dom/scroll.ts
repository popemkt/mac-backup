// Scrolling from the keyboard: which element scrolls, and by how much.
//
// The scroll target is the surface the person picked (`gs`), while it lasts;
// else the nearest vertically scrollable ancestor of where they last were
// (last click, else focus); else the scrollable element under the middle of
// the focus region (or viewport): apps like bb keep the page itself fixed and
// scroll panes inside it.
import { intersect, type Rect } from "../domain/targets.ts";
import { type DocumentPlacement, isRendered, isUncovered, viewportOf, visibleBox } from "./collect.ts";
import { parentAcrossShadow, querySelectorAllDeep } from "./tree.ts";

export type ScrollAction = "scrollDown" | "scrollUp" | "halfPageDown" | "halfPageUp" | "scrollTop" | "scrollBottom";

/** Whether the element scrolls vertically and has somewhere to go. */
export function isScrollable(element: Element): boolean {
  if (element.scrollHeight <= element.clientHeight + 1) return false;
  const doc = element.ownerDocument;
  if (element === doc.scrollingElement) return true;
  const overflow = doc.defaultView?.getComputedStyle(element).overflowY ?? "";
  return overflow === "auto" || overflow === "scroll" || overflow === "overlay";
}

function scrollableAncestor(start: Element | null): Element | undefined {
  for (let element = start; element !== null; element = parentAcrossShadow(element)) {
    if (isScrollable(element)) return element;
  }
  return undefined;
}

/** Smallest visible box, in CSS pixels, worth a scroll-surface label. */
const MIN_SURFACE = 40;

/**
 * Every surface in the placement document, open shadow roots included, that
 * scrolls vertically and shows on screen, with its visible box in top-level
 * coordinates. Nested surfaces (a code block in a transcript) both count.
 */
export function scrollSurfaces(
  placement: DocumentPlacement,
  exclude: (element: Element) => boolean,
): ReadonlyArray<{ readonly element: Element; readonly rect: Rect }> {
  const { doc } = placement;
  const viewport = viewportOf(doc);
  const page = doc.scrollingElement;
  const found: Array<{ readonly element: Element; readonly rect: Rect }> = [];
  for (const element of querySelectorAllDeep(doc, "*")) {
    // The cheap layout read first: most elements have nothing to scroll.
    if (element.scrollHeight <= element.clientHeight + 1 || exclude(element) || !isScrollable(element)) continue;
    const shown = element === page ? viewport : visibleBox(element, viewport);
    if (shown === undefined || shown.width < MIN_SURFACE || shown.height < MIN_SURFACE) continue;
    if (element !== page && (!isRendered(element) || !isUncovered(doc, element, shown))) continue;
    const rect = intersect(
      { left: shown.left + placement.offsetX, top: shown.top + placement.offsetY, width: shown.width, height: shown.height },
      placement.clip,
    );
    if (rect !== undefined) found.push({ element, rect });
  }
  return found;
}

/** Resolve the element to scroll. */
export function scrollTarget(doc: Document, starts: ReadonlyArray<Element | null>, region: Rect | undefined): Element | undefined {
  for (const start of starts) {
    if (start === null || !start.isConnected || start === doc.body || start === doc.documentElement) continue;
    const found = scrollableAncestor(start);
    if (found !== undefined) return found;
  }
  const view = doc.defaultView;
  const box = region ?? { left: 0, top: 0, width: view?.innerWidth ?? 0, height: view?.innerHeight ?? 0 };
  for (const hit of doc.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)) {
    const found = scrollableAncestor(hit);
    if (found !== undefined) return found;
  }
  const page = doc.scrollingElement;
  return page !== null && isScrollable(page) ? page : undefined;
}

/** Scroll `target` for `action`. Held keys scroll instantly, so repeats do not queue animations. */
export function scroll(target: Element, action: ScrollAction, step: number, repeat: boolean): void {
  const behavior: ScrollBehavior = repeat ? "instant" : "smooth";
  const half = Math.max(step, Math.round(target.clientHeight / 2));
  switch (action) {
    case "scrollDown":
      target.scrollBy({ top: step, behavior });
      return;
    case "scrollUp":
      target.scrollBy({ top: -step, behavior });
      return;
    case "halfPageDown":
      target.scrollBy({ top: half, behavior });
      return;
    case "halfPageUp":
      target.scrollBy({ top: -half, behavior });
      return;
    case "scrollTop":
      target.scrollTo({ top: 0, behavior: "smooth" });
      return;
    case "scrollBottom":
      target.scrollTo({ top: target.scrollHeight, behavior: "smooth" });
      return;
  }
}
