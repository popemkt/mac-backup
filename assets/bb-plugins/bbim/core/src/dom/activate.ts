// What choosing a hint does to its element, by kind. Hosts can replace it
// (CreateBbimOptions.activate); this is the DOM default.
import type { TargetKind } from "../domain/targets.ts";

export interface ActivateContext {
  readonly newTab: boolean;
  /**
   * Open a URL the host's way. Returns false to fall back to the DOM default.
   * Used for links when a new tab is asked for.
   */
  readonly openUrl?: (url: string, options: { readonly newTab: boolean }) => boolean;
}

function isMac(win: Window): boolean {
  return /Mac|iPhone|iPad/u.test(win.navigator.platform || win.navigator.userAgent);
}

/** The pointer and mouse sequence of a real primary-button click at the element's center. */
function click(element: Element, modifiers: { readonly ctrlKey?: boolean; readonly metaKey?: boolean } = {}): void {
  const view = element.ownerDocument.defaultView;
  if (view === null) return;
  const box = element.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view,
    button: 0,
    clientX: box.left + box.width / 2,
    clientY: box.top + box.height / 2,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
  };
  const pointer = { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true };
  // Radix menus open on pointerdown, popovers on click: a real click sends both.
  element.dispatchEvent(new view.PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
  const proceed = element.dispatchEvent(new view.MouseEvent("mousedown", { ...init, buttons: 1 }));
  if (proceed && "focus" in element && typeof element.focus === "function") {
    element.focus({ preventScroll: true });
  }
  element.dispatchEvent(new view.PointerEvent("pointerup", pointer));
  element.dispatchEvent(new view.MouseEvent("mouseup", init));
  element.dispatchEvent(new view.MouseEvent("click", init));
}

function caretToEnd(element: Element): void {
  if ("setSelectionRange" in element && "value" in element && typeof element.value === "string") {
    try {
      const end = element.value.length;
      (element as HTMLInputElement).setSelectionRange(end, end);
    } catch {
      // Some input types (email, number) have no selection; focus is enough.
    }
    return;
  }
  const selection = element.ownerDocument.defaultView?.getSelection();
  if (selection == null) return;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Focus an element for typing, caret at the end. */
export function focusForTyping(element: Element): void {
  if (!("focus" in element) || typeof element.focus !== "function") return;
  element.focus({ preventScroll: false });
  caretToEnd(element);
}

function openSelect(element: Element): void {
  focusForTyping(element);
  if ("showPicker" in element && typeof element.showPicker === "function") {
    try {
      element.showPicker();
    } catch {
      // showPicker needs a user activation some engines do not grant here.
    }
  }
}

function followLink(element: Element, context: ActivateContext): void {
  if (!context.newTab) {
    click(element);
    return;
  }
  const href = "href" in element && typeof element.href === "string" ? element.href : element.getAttribute("href");
  if (href !== null && href !== "" && context.openUrl?.(href, { newTab: true }) === true) return;
  // The platform's "open in new tab" click: command on macOS, control elsewhere.
  const view = element.ownerDocument.defaultView;
  const mac = view !== null && isMac(view);
  click(element, mac ? { metaKey: true } : { ctrlKey: true });
}

/** The default activation: links follow, controls click, fields focus. */
export function activateElement(element: Element, kind: TargetKind, context: ActivateContext): void {
  switch (kind) {
    case "link":
      followLink(element, context);
      return;
    case "text":
      focusForTyping(element);
      return;
    case "select":
      openSelect(element);
      return;
    case "button":
    case "toggle":
    case "weak":
      click(element);
      return;
  }
}
