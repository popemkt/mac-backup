// `gi`: which text input to focus. One picker for every host; a host narrows
// it with a selector (bb: its composers) instead of writing its own.
import { area } from "../domain/targets.ts";
import { focusForTyping } from "./activate.ts";
import { isFaded, isRendered, viewportOf, visibleBox } from "./collect.ts";
import { isEditable } from "./focus.ts";
import { closestAcrossShadow, containsAcrossShadow, parentAcrossShadow, querySelectorAllDeep } from "./tree.ts";

/** Every plain text input. */
export const TEXT_INPUT_SELECTOR =
  'textarea, input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url], [contenteditable]:not([contenteditable="false"])';

export interface InputChoice {
  /** Which inputs count. */
  readonly selector: string;
  /** The input last typed into: chosen again while it still counts and shows. */
  readonly lastEditable: Element | null;
  /** Where the person is (focus, last click): the nearest inputs around it win. */
  readonly near: Element | null;
}

function biggest(fields: ReadonlyArray<{ readonly element: Element; readonly size: number }>): Element | undefined {
  let best: { readonly element: Element; readonly size: number } | undefined;
  for (const field of fields) if (best === undefined || field.size > best.size) best = field;
  return best?.element;
}

/**
 * The input `gi` focuses: the last one used, else the biggest in the nearest
 * pane around `near` that has any, else the biggest on screen.
 */
export function pickInput(doc: Document, choice: InputChoice): Element | undefined {
  const view = viewportOf(doc);
  const fields: Array<{ readonly element: Element; readonly size: number }> = [];
  for (const element of querySelectorAllDeep(doc, choice.selector)) {
    // A transparent field (an editor's hidden IME textarea) is not where anyone means to type.
    if (!isEditable(element) || element.matches(":disabled") || !isRendered(element) || isFaded(element)) continue;
    // Inside a contenteditable region only the region itself is an input.
    const parent = parentAcrossShadow(element);
    if (parent !== null && closestAcrossShadow(parent, '[contenteditable]:not([contenteditable="false"])') !== null) continue;
    const box = visibleBox(element, view);
    if (box !== undefined) fields.push({ element, size: area(box) });
  }
  if (fields.length === 0) return undefined;
  if (choice.lastEditable !== null && fields.some((field) => field.element === choice.lastEditable)) {
    return choice.lastEditable;
  }
  for (let scope = choice.near; scope !== null; scope = parentAcrossShadow(scope)) {
    const within = scope;
    const inside = fields.filter((field) => containsAcrossShadow(within, field.element));
    if (inside.length > 0) return biggest(inside);
  }
  return biggest(fields);
}

/** Focus the input `pickInput` chooses; false when there is none. */
export function focusInput(doc: Document, choice: InputChoice): boolean {
  const chosen = pickInput(doc, choice);
  if (chosen === undefined) return false;
  focusForTyping(chosen);
  return true;
}
