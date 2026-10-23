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

/** The first element matching `selector` in `root` or any open shadow root below it. */
export function querySelectorDeep(root: Document | ShadowRoot, selector: string): Element | null {
  const direct = root.querySelector(selector);
  if (direct !== null) return direct;
  for (const element of root.querySelectorAll("*")) {
    const shadow = element.shadowRoot;
    if (shadow === null) continue;
    const found = querySelectorDeep(shadow, selector);
    if (found !== null) return found;
  }
  return null;
}
