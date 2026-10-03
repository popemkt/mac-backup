/**
 * Auto-hiding scrollbar thumbs (DESIGN-RESKIN §1.1) — ported from nxus
 * apps/nxus-editor/src/routes/__root.tsx ScrollbarManager.
 *
 * An element is marked `data-scrolling` while it scrolls and for a second
 * after. Scroll events fire every frame, so the mark is written only when it
 * is absent — an attribute write invalidates style even when the value is
 * unchanged — and each element keeps its own timer, so scrolling a second
 * element does not strand the first one's mark.
 */
import { asInstance } from "@/lib/dom";

const SCROLLING_ATTR = "data-scrolling";
const SETTLE_MS = 1000;

export function initScrollbarManager() {
  if (typeof window === "undefined") return;

  const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

  const handleScroll = (e: Event) => {
    const target = e.target;
    const element =
      target === document ? document.documentElement : asInstance(target, HTMLElement);
    if (element === undefined) return;

    if (!element.hasAttribute(SCROLLING_ATTR)) element.setAttribute(SCROLLING_ATTR, "true");

    const pending = timers.get(element);
    if (pending !== undefined) clearTimeout(pending);
    timers.set(
      element,
      setTimeout(() => {
        timers.delete(element);
        element.removeAttribute(SCROLLING_ATTR);
      }, SETTLE_MS),
    );
  };

  window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
}
