// Where the keyboard is, and whether bbim may act on a key there.
//
// A focus state is decided per key: `free` (nothing takes typing; bare keys
// and chords both work), `typing` (a text field has focus; chords work, bare
// keys type), or `blocked` (bbim stands aside entirely: a modal, a terminal,
// an embedded browser). The host adds its own guards; the strictest answer
// among all guards wins.
import { closestAcrossShadow, querySelectorDeep } from "./tree.ts";

export type FocusState = "free" | "typing" | "blocked";

/** A host's opinion about an element having focus; undefined when it has none. */
export type FocusGuard = (element: Element | null) => FocusState | undefined;

const RANK: Readonly<Record<FocusState, number>> = { free: 0, typing: 1, blocked: 2 };

const NON_TEXT_INPUTS = new Set([
  "button",
  "submit",
  "reset",
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "image",
  "hidden",
]);

/** Whether typing into `element` would insert text. */
export function isEditable(element: Element | null): boolean {
  if (element === null) return false;
  const tag = element.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    return !NON_TEXT_INPUTS.has(type);
  }
  return closestAcrossShadow(element, '[contenteditable]:not([contenteditable="false"])') !== null;
}

/** The default guard: editable elements are `typing`. */
export const editableGuard: FocusGuard = (element) => (isEditable(element) ? "typing" : undefined);

/** The focused element, looking through open shadow roots and same-origin frames. */
export function deepActiveElement(doc: Document): Element | null {
  let active: Element | null = doc.activeElement;
  for (let depth = 0; depth < 32 && active !== null; depth += 1) {
    const shadowActive = active.shadowRoot?.activeElement ?? null;
    if (shadowActive !== null) {
      active = shadowActive;
      continue;
    }
    if (active.tagName === "IFRAME" || active.tagName === "FRAME") {
      let inner: Document | null = null;
      try {
        inner = (active as HTMLIFrameElement).contentDocument;
      } catch {
        inner = null;
      }
      if (inner?.activeElement != null) {
        active = inner.activeElement;
        continue;
      }
    }
    break;
  }
  return active;
}

/** The strictest state any guard reports for `element`. */
export function focusState(guards: ReadonlyArray<FocusGuard>, element: Element | null): FocusState {
  let state: FocusState = "free";
  for (const guard of guards) {
    const opinion = guard(element);
    if (opinion !== undefined && RANK[opinion] > RANK[state]) state = opinion;
  }
  return state;
}

/** An open ARIA modal dialog anywhere in the document. */
export const MODAL_SELECTOR = [
  '[aria-modal="true"]:not([inert]):not([inert] *):not([data-state="closed"])',
  '[role="dialog"][data-state="open"]:not([inert]):not([inert] *)',
].join(", ");

/** An open menu or listbox, which takes letters for its own typeahead. */
export const MENU_SELECTOR = [
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(", ");

/**
 * A guard that reports `state` while something matching `selector` is in the
 * document or any open shadow root in it, whatever has focus. A modal takes the keyboard (`blocked`); an
 * open menu takes letters for its typeahead but chords still reach bbim
 * (`typing`), so hints can still pick a menu item.
 */
export function presenceGuard(doc: Document, selector: string, state: FocusState): FocusGuard {
  return () => (querySelectorDeep(doc, selector) !== null ? state : undefined);
}

/**
 * A guard that blocks inside anything matching `selector` (a terminal, a
 * webview), across open shadow roots. Inside a closed shadow root focus is
 * seen on its host, so the selector must match the host or an ancestor.
 */
export function withinGuard(selector: string): FocusGuard {
  return (element) => (closestAcrossShadow(element, selector) !== null ? "blocked" : undefined);
}
