/**
 * The one reader of `prefers-reduced-motion`.
 *
 * CSS motion is flattened by the global rule in `index.css`; this is the same
 * question asked from script, for motion CSS cannot see — camera tweens, the
 * theme View Transition, a WebGL scene's animation loop.
 */
const QUERY = "(prefers-reduced-motion: reduce)";

function query(): MediaQueryList | null {
  return typeof window === "undefined" || typeof window.matchMedia !== "function"
    ? null
    : window.matchMedia(QUERY);
}

export function prefersReducedMotion(): boolean {
  return query()?.matches === true;
}
