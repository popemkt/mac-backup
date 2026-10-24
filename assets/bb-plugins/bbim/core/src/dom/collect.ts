// Finding hint targets in one document: candidates by selector, kept only when
// they are on screen, rendered, and not covered by something else.
//
// Visibility has two parts. Rendered (display, visibility, content-visibility)
// decides whether something is a target at all. Faded (opacity near zero,
// its own or an ancestor's) does not: a control drawn only on hover is still
// there to click, so it is a target flagged `faded`, labeled after the rest.
import { type Candidate, classify, dedupe, intersect, type Rect, type TargetKind } from "../domain/targets.ts";
import { closestAcrossShadow, containsAcrossShadow, parentAcrossShadow, querySelectorAllDeep } from "./tree.ts";

/** What counts as interactive, before visibility filtering. */
export const DEFAULT_SELECTORS: ReadonlyArray<string> = [
  "a[href]",
  "area[href]",
  "button",
  "input:not([type=hidden])",
  "textarea",
  "select",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="radio"]',
  '[role="option"]',
  '[role="treeitem"]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]:not([contenteditable="false"])',
  // Cheap signs of a click handler on an otherwise plain element.
  "[onclick]",
  "[aria-haspopup]:not([aria-haspopup=false])",
  "[aria-expanded]",
];

export interface CollectOptions {
  /** CSS selectors for candidates. */
  readonly selectors: ReadonlyArray<string>;
  /** Drop a candidate the host knows is not a target (its own chrome, say). */
  readonly exclude?: (element: Element) => boolean;
}

/** A target found in a document, in the top-level viewport's coordinates. */
export interface LocalTarget {
  readonly element: Element;
  readonly kind: TargetKind;
  readonly rect: Rect;
  /** Transparent until hovered or focused (`opacity-0 group-hover:opacity-100`). */
  readonly faded: boolean;
}

/** Where a document sits in the top-level viewport. */
export interface DocumentPlacement {
  readonly doc: Document;
  /** Offset of the document's viewport origin in top-level coordinates. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** The part of the top-level viewport this document shows (its frame's box). */
  readonly clip: Rect;
}

/** Smallest box, in CSS pixels, worth a hint. */
const MIN_SIZE = 3;

export function viewportOf(doc: Document): Rect {
  const view = doc.defaultView;
  const width = view?.innerWidth ?? doc.documentElement.clientWidth;
  const height = view?.innerHeight ?? doc.documentElement.clientHeight;
  return { left: 0, top: 0, width, height };
}

function toRect(box: DOMRectReadOnly): Rect {
  return { left: box.left, top: box.top, width: box.width, height: box.height };
}

/** The first of the element's boxes (a wrapped link has several) that is on screen. */
export function visibleBox(element: Element, viewport: Rect): Rect | undefined {
  for (const box of element.getClientRects()) {
    if (box.width < MIN_SIZE || box.height < MIN_SIZE) continue;
    const shown = intersect(toRect(box), viewport);
    if (shown !== undefined && shown.width >= MIN_SIZE && shown.height >= MIN_SIZE) return shown;
  }
  return undefined;
}

/** Whether `element` is laid out and painted at all: display, visibility and content-visibility, not opacity. */
export function isRendered(element: Element): boolean {
  if (typeof element.checkVisibility === "function") {
    return element.checkVisibility({ visibilityProperty: true });
  }
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style === undefined || (style.visibility !== "hidden" && style.display !== "none");
}

/** Below this effective opacity a control reads as absent until hovered. */
const FADED_OPACITY = 0.05;

/**
 * The opacity `element` is painted with: its own times every ancestor's,
 * across shadow hosts. `cache` shares the ancestors' answers within one pass.
 */
function effectiveOpacity(element: Element, cache: Map<Element, number>): number {
  const known = cache.get(element);
  if (known !== undefined) return known;
  const own = Number.parseFloat(element.ownerDocument.defaultView?.getComputedStyle(element).opacity ?? "");
  const parent = parentAcrossShadow(element);
  const opacity = (Number.isFinite(own) ? own : 1) * (parent === null ? 1 : effectiveOpacity(parent, cache));
  cache.set(element, opacity);
  return opacity;
}

/** Whether `element` is rendered but transparent: there to click, drawn only on hover or focus. */
export function isFaded(element: Element, cache: Map<Element, number> = new Map()): boolean {
  return effectiveOpacity(element, cache) < FADED_OPACITY;
}

function isDisabled(element: Element): boolean {
  return element.matches(":disabled") || element.getAttribute("aria-disabled") === "true";
}

/**
 * Whether a hit at a point belongs to `element`: itself, inside it, or its
 * label. A document hit-tests shadow content to its host, so ancestry crosses
 * shadow roots.
 */
function owns(element: Element, hit: Element): boolean {
  if (hit === element || containsAcrossShadow(element, hit) || containsAcrossShadow(hit, element)) return true;
  const label = hit.closest("label");
  return label !== null && (label.control === element || label.contains(element));
}

/**
 * Whether some of `shown` is really visible: a point of it hit-tests to the
 * element, so no other element (a dialog, a sticky header) is painted over it.
 */
export function isUncovered(doc: Document, element: Element, shown: Rect): boolean {
  const points: ReadonlyArray<readonly [number, number]> = [
    [0.5, 0.5],
    [0.15, 0.5],
    [0.85, 0.5],
    [0.5, 0.15],
    [0.5, 0.85],
  ];
  for (const [fx, fy] of points) {
    const hit = doc.elementFromPoint(shown.left + shown.width * fx, shown.top + shown.height * fy);
    if (hit !== null && owns(element, hit)) return true;
  }
  return false;
}

/** The facts `classify` reads off an element. */
function factsOf(element: Element): Parameters<typeof classify>[0] {
  return {
    tag: element.tagName,
    type: element.getAttribute("type"),
    role: element.getAttribute("role"),
    hasHref: element.hasAttribute("href"),
    // Not `instanceof HTMLElement`: a same-origin frame's elements come from another realm.
    contentEditable: "isContentEditable" in element && element.isContentEditable === true,
  };
}

/** Targets in one document, deduplicated, in top-level coordinates. */
export function collectTargets(placement: DocumentPlacement, options: CollectOptions): ReadonlyArray<LocalTarget> {
  const { doc } = placement;
  const viewport = viewportOf(doc);
  const found: Array<LocalTarget & Candidate> = [];
  const seen = new Set<Element>();
  const opacities = new Map<Element, number>();
  // Open shadow roots too: a component-built pane (a plugin's) is as clickable as the page.
  for (const element of querySelectorAllDeep(doc, options.selectors.join(","))) {
    if (seen.has(element)) continue;
    seen.add(element);
    if (options.exclude?.(element) === true || isDisabled(element)) continue;
    // A contenteditable region's descendants are part of one text target.
    const parent = parentAcrossShadow(element);
    if (parent !== null && closestAcrossShadow(parent, '[contenteditable]:not([contenteditable="false"])') !== null) continue;
    const shown = visibleBox(element, viewport);
    if (shown === undefined || !isRendered(element) || !isUncovered(doc, element, shown)) continue;
    const kind = classify(factsOf(element));
    if (kind === undefined) continue;
    const placed = intersect(
      { left: shown.left + placement.offsetX, top: shown.top + placement.offsetY, width: shown.width, height: shown.height },
      placement.clip,
    );
    if (placed === undefined) continue;
    found.push({ element, kind, rect: placed, faded: isFaded(element, opacities) });
  }
  const indexOf = new Map(found.map((target, index) => [target.element, index]));
  const ancestors = function* (inner: number): Generator<number> {
    const start = found[inner]?.element;
    for (let at = start === undefined ? null : parentAcrossShadow(start); at !== null; at = parentAcrossShadow(at)) {
      const outer = indexOf.get(at);
      if (outer !== undefined) yield outer;
    }
  };
  const kept = dedupe(found, ancestors, placement.clip);
  return kept.flatMap((index) => {
    const target = found[index];
    return target === undefined ? [] : [{ element: target.element, kind: target.kind, rect: target.rect, faded: target.faded }];
  });
}
