import { useSyncExternalStore } from "react";

/**
 * Below this width the sidebar cannot sit beside the page without pushing it
 * into a sideways scroll, so it floats over the page instead. It matches
 * Tailwind's `md` breakpoint, which the sidebar's `max-md:` classes use.
 */
const NARROW_QUERY = "(max-width: 767.98px)";

function narrowQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(NARROW_QUERY)
    : null;
}

function subscribe(onChange: () => void): () => void {
  const query = narrowQuery();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

const isNarrow = (): boolean => narrowQuery()?.matches === true;

/** True while the viewport is narrower than the sidebar's docking breakpoint. */
export function useNarrowViewport(): boolean {
  return useSyncExternalStore(subscribe, isNarrow, () => false);
}
