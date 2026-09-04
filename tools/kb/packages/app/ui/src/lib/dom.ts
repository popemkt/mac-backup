/**
 * The DOM boundary: `EventTarget`, `Node` and `unknown` where a handler needs
 * a concrete element.
 *
 * Everything here *checks* — nothing asserts. One place decides what "this
 * event happened on an element" means, so a handler that needs `.closest()`,
 * `.blur()` or `.setPointerCapture()` states which element type it needs and
 * gets `undefined` when the target is not one.
 *
 * Node kinds are decided by `nodeType`, not by `instanceof`: the component
 * tests drive a happy-dom `Window` installed onto `globalThis` a global at a
 * time, so `Element` and `Text` are not constructors this code can name.
 */

/** `Node.ELEMENT_NODE` and `Node.TEXT_NODE`, spelled out so no realm is assumed. */
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export function isElementNode(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE;
}

export function isTextNode(node: Node): node is Text {
  return node.nodeType === TEXT_NODE;
}

/** The value, when it is an instance of `ctor`; `undefined` otherwise. */
export function asInstance<T>(
  value: unknown,
  ctor: abstract new (...args: never[]) => T,
): T | undefined {
  return value instanceof ctor ? value : undefined;
}

/** The event target as an element — `undefined` when it is not one. */
export function asElement(target: unknown): Element | undefined {
  const node = asInstance(target, Node);
  return node !== undefined && isElementNode(node) ? node : undefined;
}

/**
 * True when an event did not land inside `container` — the dismiss condition
 * every popover and inspector asks. A missing container, or a target that is
 * not a DOM node, is outside.
 */
export function isOutside(container: Node | null | undefined, target: unknown): boolean {
  if (container === null || container === undefined) return true;
  const node = asInstance(target, Node);
  return node === undefined || !container.contains(node);
}

/**
 * True when an event landed in a text-entry surface. Every hotkey handler that
 * declines to act "while the user is typing" asks exactly this question.
 */
export function isTextEntry(target: unknown): boolean {
  const el = asInstance(target, HTMLElement);
  if (el === undefined) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}
