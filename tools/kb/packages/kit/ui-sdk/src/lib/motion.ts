/**
 * The one reader of `prefers-reduced-motion`.
 *
 * CSS motion is flattened by the global rule in `index.css`; this is the same
 * question asked from script, for motion CSS cannot see — camera tweens, the
 * theme View Transition, a WebGL scene's animation loop.
 */
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function query(): MediaQueryList | null {
  return typeof window === "undefined" || typeof window.matchMedia !== "function"
    ? null
    : window.matchMedia(QUERY);
}

export function prefersReducedMotion(): boolean {
  return query()?.matches === true;
}

function subscribe(onChange: () => void): () => void {
  const list = query();
  // A test double may hand back a bare `{ matches }` with no listener API.
  if (list === null || typeof list.addEventListener !== "function") return () => {};
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/** `prefersReducedMotion`, re-read when the user changes the setting. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
