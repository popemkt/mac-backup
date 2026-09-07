import { flushSync } from "react-dom";

let active: ViewTransition | null = null;
let revision = 0;

/** Capture the complete old/new theme once; rapid choices always settle on the last. */
export function transitionTheme(update: () => void, appearanceChanges: boolean): void {
  const current = ++revision;
  active?.skipTransition();
  active = null;
  const root = typeof document === "undefined" ? null : document.documentElement;
  root?.removeAttribute("data-theme-transition");
  const reduced =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (
    !root ||
    !appearanceChanges ||
    reduced ||
    typeof document.startViewTransition !== "function"
  ) {
    update();
    return;
  }

  root.setAttribute("data-theme-transition", "true");
  try {
    const transition = document.startViewTransition(() => {
      if (current === revision) flushSync(update);
    });
    active = transition;
    void transition.ready.catch(() => {});
    void transition.finished
      .catch(() => {})
      .finally(() => {
        if (current !== revision) return;
        active = null;
        root.removeAttribute("data-theme-transition");
      });
  } catch {
    root.removeAttribute("data-theme-transition");
    update();
  }
}
