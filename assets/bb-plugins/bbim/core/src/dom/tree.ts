// Walking the element tree across open shadow roots. `closest` and
// `querySelector` stop at a shadow boundary, so an app built from web
// components (bb's terminal and browser views among them) would hide its
// focus from every guard. Closed shadow roots stay opaque: their host is as
// deep as anything outside can see, so a guard sees focus on the host.

/** The parent element, or the host when `element` is a shadow root's child. */
export function parentAcrossShadow(element: Element): Element | null {
  if (element.parentElement !== null) return element.parentElement;
  const root = element.getRootNode();
  return "host" in root && root.host !== null && typeof root.host === "object" ? (root.host as Element) : null;
}

/** `element.closest(selector)`, continuing through shadow hosts. */
export function closestAcrossShadow(element: Element | null, selector: string): Element | null {
  for (let at = element; at !== null; at = parentAcrossShadow(at)) {
    if (at.matches(selector)) return at;
  }
  return null;
}

/** Whether `element` is `scope` or inside it, counting shadow hosts as containers. */
export function containsAcrossShadow(scope: Element, element: Element): boolean {
  for (let at: Element | null = element; at !== null; at = parentAcrossShadow(at)) {
    if (at === scope) return true;
  }
  return false;
}

/** `root`, then every open shadow root below it, lazily. */
function* deepRoots(root: Document | ShadowRoot): Generator<Document | ShadowRoot> {
  yield root;
  for (const element of root.querySelectorAll("*")) {
    if (element.shadowRoot !== null) yield* deepRoots(element.shadowRoot);
  }
}

/** The first element matching `selector` in `root` or any open shadow root below it. */
export function querySelectorDeep(root: Document | ShadowRoot, selector: string): Element | null {
  for (const at of deepRoots(root)) {
    const found = at.querySelector(selector);
    if (found !== null) return found;
  }
  return null;
}

/** Every element matching `selector` in `root` and the open shadow roots below it. */
export function querySelectorAllDeep(root: Document | ShadowRoot, selector: string): ReadonlyArray<Element> {
  const found: Array<Element> = [];
  for (const at of deepRoots(root)) found.push(...at.querySelectorAll(selector));
  return found;
}
