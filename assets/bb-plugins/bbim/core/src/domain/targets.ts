// What a hint target is, independent of the DOM: its kind, its box, and the
// rules for which nested targets to keep and in which order labels go out.
import { Schema } from "effect";

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * What activating a target does. `link` follows, `button` clicks, `text`
 * focuses for typing, `select` focuses and opens, `toggle` clicks a checkbox,
 * radio or switch. `weak` is a target found only by a hint of clickability
 * (a tabindex, a popup trigger attribute): it is clicked, but yields to any
 * stronger target it overlaps.
 */
export const TargetKind = Schema.Literals(["link", "button", "text", "select", "toggle", "weak"]);
export type TargetKind = typeof TargetKind.Type;

/** The element facts classification needs, read off a DOM element. */
export interface ElementFacts {
  readonly tag: string;
  readonly type: string | null;
  readonly role: string | null;
  readonly hasHref: boolean;
  readonly contentEditable: boolean;
}

const TEXT_INPUT_TYPES = new Set([
  "",
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);
const BUTTON_INPUT_TYPES = new Set(["button", "submit", "reset", "image", "file", "color", "range"]);
const TOGGLE_INPUT_TYPES = new Set(["checkbox", "radio"]);
const BUTTON_ROLES = new Set(["button", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "treeitem"]);
const TOGGLE_ROLES = new Set(["checkbox", "switch", "radio"]);

/** The kind of a candidate, or undefined when it is not a target at all. */
export function classify(facts: ElementFacts): TargetKind | undefined {
  const tag = facts.tag.toLowerCase();
  const role = facts.role?.trim().toLowerCase() ?? null;
  if (tag === "input") {
    const type = (facts.type ?? "").toLowerCase();
    if (type === "hidden") return undefined;
    if (TOGGLE_INPUT_TYPES.has(type)) return "toggle";
    if (BUTTON_INPUT_TYPES.has(type)) return "button";
    return TEXT_INPUT_TYPES.has(type) ? "text" : "button";
  }
  if (tag === "textarea" || facts.contentEditable) return "text";
  if (tag === "select") return "select";
  if ((tag === "a" || tag === "area") && facts.hasHref) return "link";
  if (role === "link") return "link";
  if (role !== null && TOGGLE_ROLES.has(role)) return "toggle";
  if (tag === "button" || tag === "summary" || (role !== null && BUTTON_ROLES.has(role))) return "button";
  // Matched by a weak selector only (tabindex, popup-trigger attributes).
  return "weak";
}

export function area(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

export function intersect(a: Rect, b: Rect): Rect | undefined {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  if (right <= left || bottom <= top) return undefined;
  return { left, top, width: right - left, height: bottom - top };
}

/** Intersection over union of two boxes, 0 when they do not overlap. */
export function overlap(a: Rect, b: Rect): number {
  const shared = intersect(a, b);
  if (shared === undefined) return 0;
  const sharedArea = area(shared);
  return sharedArea / (area(a) + area(b) - sharedArea);
}

export interface Candidate {
  readonly kind: TargetKind;
  readonly rect: Rect;
}

/** Boxes this similar are one control drawn twice (a link wrapping its button). */
const SAME_BOX = 0.85;
/** A weak candidate bigger than this share of the viewport is a container, not a control. */
const CONTAINER_SHARE = 0.25;

const STRENGTH: Readonly<Record<TargetKind, number>> = {
  text: 5,
  select: 5,
  toggle: 4,
  link: 3,
  button: 3,
  weak: 0,
};

/**
 * Indexes of the candidates worth a hint. `contains(outer, inner)` answers
 * whether candidate `outer` is an ancestor of candidate `inner`.
 *
 * - A weak candidate covering a quarter of the viewport is a scroll region or
 *   a card, not a control: dropped.
 * - Nested candidates with nearly the same box are one control: the stronger
 *   one stays (the inner one on a tie, it is the more specific element).
 * - A weak candidate inside another candidate adds nothing: dropped.
 * - A weak candidate wrapping stronger ones defers to them: dropped.
 * - Otherwise nested candidates both stay: a row link with its own menu
 *   button is two actions.
 */
export function dedupe(
  candidates: ReadonlyArray<Candidate>,
  contains: (outer: number, inner: number) => boolean,
  viewport: Rect,
): ReadonlyArray<number> {
  const dropped = new Set<number>();
  const viewportArea = Math.max(1, area(viewport));
  candidates.forEach((candidate, index) => {
    if (candidate.kind === "weak" && area(candidate.rect) / viewportArea > CONTAINER_SHARE) dropped.add(index);
  });
  for (let outer = 0; outer < candidates.length; outer += 1) {
    for (let inner = 0; inner < candidates.length; inner += 1) {
      if (outer === inner || dropped.has(outer) || dropped.has(inner) || !contains(outer, inner)) continue;
      const a = candidates[outer];
      const b = candidates[inner];
      if (a === undefined || b === undefined) continue;
      if (overlap(a.rect, b.rect) >= SAME_BOX) {
        dropped.add(STRENGTH[a.kind] > STRENGTH[b.kind] ? inner : outer);
      } else if (b.kind === "weak") {
        dropped.add(inner);
      } else if (a.kind === "weak") {
        dropped.add(outer);
      }
    }
  }
  return candidates.flatMap((_, index) => (dropped.has(index) ? [] : [index]));
}

/**
 * The order labels are handed out in: shortest labels go first. Targets inside
 * the focus region (the pane the person is working in) come before the rest;
 * within each group, nearest to the region's top-left corner first, rows
 * weighing more than columns so a line reads left to right.
 */
export function order(rects: ReadonlyArray<Rect>, focus: Rect | undefined): ReadonlyArray<number> {
  const anchor = focus ?? { left: 0, top: 0, width: 0, height: 0 };
  const scored = rects.map((rect, index) => {
    const inside = focus !== undefined && intersect(rect, focus) !== undefined;
    const dx = Math.abs(rect.left - anchor.left);
    const dy = Math.abs(rect.top - anchor.top);
    return { index, group: inside || focus === undefined ? 0 : 1, distance: dy * 2 + dx };
  });
  scored.sort((a, b) => a.group - b.group || a.distance - b.distance || a.index - b.index);
  return scored.map((entry) => entry.index);
}
