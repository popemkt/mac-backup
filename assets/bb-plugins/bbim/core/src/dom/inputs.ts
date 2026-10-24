// `gi`: which text inputs it labels and which one it means by default. One
// mechanism for every host; a host narrows the candidates with a selector
// and names the ones it prefers (bb: its composers) instead of writing its own.
import { area, intersect, type Rect } from "../domain/targets.ts";
import { type DocumentPlacement, isFaded, isRendered, isUncovered, viewportOf, visibleBox } from "./collect.ts";
import { isEditable } from "./focus.ts";
import { closestAcrossShadow, containsAcrossShadow, parentAcrossShadow, querySelectorAllDeep } from "./tree.ts";

/** Every plain text input. */
export const TEXT_INPUT_SELECTOR =
  'textarea, input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url], [contenteditable]:not([contenteditable="false"])';

export interface InputChoice {
  /** The input last typed into: chosen again while it still counts and shows. */
  readonly lastEditable: Element | null;
  /** Where the person is (focus, last click): the nearest inputs around it win. */
  readonly near: Element | null;
  /** Inputs that win over the rest when none was used last (bb: its composers). */
  readonly prefer?: string;
}

export interface InputField {
  readonly element: Element;
  /** Its visible box in top-level coordinates. */
  readonly rect: Rect;
}

/** Every input in one document someone could mean to type into, placed in the top-level viewport. */
export function inputFields(placement: DocumentPlacement, selector: string): ReadonlyArray<InputField> {
  const { doc } = placement;
  const view = viewportOf(doc);
  const fields: Array<InputField> = [];
  for (const element of querySelectorAllDeep(doc, selector)) {
    // A transparent field (an editor's hidden IME textarea) is not where anyone means to type.
    if (!isEditable(element) || element.matches(":disabled") || !isRendered(element) || isFaded(element)) continue;
    // Inside a contenteditable region only the region itself is an input.
    const parent = parentAcrossShadow(element);
    if (parent !== null && closestAcrossShadow(parent, '[contenteditable]:not([contenteditable="false"])') !== null) continue;
    const box = visibleBox(element, view);
    // One under a dialog is not where anyone can type either.
    if (box === undefined || !isUncovered(doc, element, box)) continue;
    const rect = intersect(
      { left: box.left + placement.offsetX, top: box.top + placement.offsetY, width: box.width, height: box.height },
      placement.clip,
    );
    if (rect !== undefined) fields.push({ element, rect });
  }
  return fields;
}

/** The biggest field in the nearest scope around `near` that holds any, else the biggest. */
function nearestBiggest(fields: ReadonlyArray<InputField>, near: Element | null): Element | undefined {
  const biggest = (among: ReadonlyArray<InputField>) => {
    let best: InputField | undefined;
    for (const field of among) if (best === undefined || area(field.rect) > area(best.rect)) best = field;
    return best?.element;
  };
  for (let scope = near; scope !== null; scope = parentAcrossShadow(scope)) {
    const within = scope;
    const inside = fields.filter((field) => containsAcrossShadow(within, field.element));
    if (inside.length > 0) return biggest(inside);
  }
  return biggest(fields);
}

/**
 * The input `gi` means without being told: the last one used while it still
 * shows, else a preferred one (the nearest pane's), else the biggest in the
 * nearest pane around `near`, else the biggest on screen.
 */
export function preferredInput(fields: ReadonlyArray<InputField>, choice: InputChoice): Element | undefined {
  if (choice.lastEditable !== null && fields.some((field) => field.element === choice.lastEditable)) return choice.lastEditable;
  const { prefer } = choice;
  const preferred = prefer === undefined ? [] : fields.filter((field) => field.element.matches(prefer));
  return nearestBiggest(preferred.length > 0 ? preferred : fields, choice.near);
}
