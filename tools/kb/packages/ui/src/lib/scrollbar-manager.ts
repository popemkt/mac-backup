/**
 * Auto-hiding scrollbar thumbs (DESIGN-RESKIN §1.1) — ported from nxus
 * apps/nxus-editor/src/routes/__root.tsx ScrollbarManager.
 */
import { asInstance } from "@/lib/dom";
export function initScrollbarManager() {
  if (typeof window === "undefined") return;

  let timeout: ReturnType<typeof setTimeout> | undefined;

  const handleScroll = (e: Event) => {
    const target = e.target;
    const element =
      target === document ? document.documentElement : asInstance(target, HTMLElement);
    if (element === undefined) return;

    element.setAttribute("data-scrolling", "true");

    if (timeout !== undefined) clearTimeout(timeout);
    timeout = setTimeout(() => {
      element.removeAttribute("data-scrolling");
    }, 1000);
  };

  window.addEventListener("scroll", handleScroll, true);
}
