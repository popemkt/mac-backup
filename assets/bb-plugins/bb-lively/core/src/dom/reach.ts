// The dock band's art reach. A preset's backdrop art is painted twice: behind
// the thread (on `pageView`) and again on the opaque dock band, so it runs to
// the bottom edge (art.ts). Both copies are anchored to the bottom-right corner,
// which only meets seamlessly if both boxes share that corner. The band sits
// inside the thread's scroller, though, so a classic scrollbar (any gutter, or
// anything else between the two) pulls its right or bottom edge in from the
// view's: its copy of the art lands that far to the left, a step in every
// slanted stroke.
//
// CSS cannot see that gap, so this measures it, per band, as the distance from
// the band's right and bottom edges to its view's, and writes it on the band
// (REACH). The art stretches the band's layer by it (art.ts surfaceRule): both
// copies then share the view's corner and its mask, one continuous picture.
// The stretch is clipped by the scroller, so nothing shows under the scrollbar.
//
// A ResizeObserver per band and view measures again on any size change (a
// window resize, a scrollbar appearing, a panel opening); bands are found by
// a cheap periodic query, as rows.ts finds lists. Reads layout only there.
import type { Targets } from "./targets.ts";

/** The custom properties the art's band layer reaches out by (px, set on each dock band). */
export const REACH = {
  right: "--lively-reach-right",
  bottom: "--lively-reach-bottom",
} as const;

const SCAN_MS = 1000;

export interface ReachWatcher {
  /** Look for new bands now and measure them (also runs every second). */
  scan(): void;
  /** Measure every band now. */
  measure(): void;
  dispose(): void;
}

/** The gap from a band's edge to its view's, never negative, to a tenth of a pixel. */
const gap = (outer: number, inner: number) => `${Math.max(0, Math.round((outer - inner) * 10) / 10)}px`;

export function createReachWatcher(options: { readonly win: Window; readonly targets: Targets }): ReachWatcher {
  const { win, targets } = options;
  const doc = win.document;
  /** Each band and the view it belongs to. */
  const bands = new Map<HTMLElement, Element>();
  let timer: ReturnType<Window["setTimeout"]> | undefined;
  let disposed = false;

  const measureOne = (band: HTMLElement, view: Element) => {
    const outer = view.getBoundingClientRect();
    const inner = band.getBoundingClientRect();
    band.style.setProperty(REACH.right, gap(outer.right, inner.right));
    band.style.setProperty(REACH.bottom, gap(outer.bottom, inner.bottom));
  };
  const measure = () => {
    for (const [band, view] of bands) if (band.isConnected) measureOne(band, view);
  };
  const Observer = (win as Window & typeof globalThis).ResizeObserver as typeof ResizeObserver | undefined;
  const observer = Observer === undefined ? undefined : new Observer(() => measure());

  const forget = (band: HTMLElement, view: Element) => {
    observer?.unobserve(band);
    if (![...bands].some(([other, shared]) => other !== band && shared === view)) observer?.unobserve(view);
    bands.delete(band);
  };
  const scan = () => {
    for (const [band, view] of bands) if (!band.isConnected || !view.isConnected) forget(band, view);
    for (const band of doc.querySelectorAll<HTMLElement>(targets.dock)) {
      if (bands.has(band)) continue;
      const view = band.closest(targets.pageView);
      if (view === null) continue;
      bands.set(band, view);
      observer?.observe(band);
      observer?.observe(view);
      measureOne(band, view);
    }
  };
  const tick = () => {
    if (disposed) return;
    scan();
    timer = win.setTimeout(tick, SCAN_MS);
  };
  tick();

  return {
    scan,
    measure,
    dispose: () => {
      disposed = true;
      if (timer !== undefined) win.clearTimeout(timer);
      observer?.disconnect();
      for (const band of bands.keys()) {
        band.style.removeProperty(REACH.right);
        band.style.removeProperty(REACH.bottom);
      }
      bands.clear();
    },
  };
}
