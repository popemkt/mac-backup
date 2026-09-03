/**
 * Auto-hiding scrollbar thumbs (DESIGN-RESKIN §1.1) — ported from nxus
 * apps/nxus-editor/src/routes/__root.tsx ScrollbarManager.
 */
export function initScrollbarManager() {
  if (typeof window === "undefined") return;

  let timeout: ReturnType<typeof setTimeout> | undefined;

  const handleScroll = (e: Event) => {
    const target = e.target;
    if (!target || !(target instanceof HTMLElement || target === document)) {
      return;
    }

    const element = target === document ? document.documentElement : (target as HTMLElement);

    element.setAttribute("data-scrolling", "true");

    if (timeout !== undefined) clearTimeout(timeout);
    timeout = setTimeout(() => {
      element.removeAttribute("data-scrolling");
    }, 1000);
  };

  window.addEventListener("scroll", handleScroll, true);
}
