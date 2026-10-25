// The dock band's art reach. A preset's backdrop art is painted twice: behind
// the thread (on `pageView`) and again on the opaque dock band, so it runs to
// the bottom edge (art.ts). Both copies are anchored to the bottom-right corner,
// which only meets seamlessly if both boxes share that corner. The band sits
// inside the thread's scroller, though, so a classic scrollbar (any gutter, or
// anything else between the two) pulls its right or bottom edge in from the
// view's: its copy of the art lands that far to the left, a step in every
// slanted stroke.
//
// CSS cannot see that gap: the band's nearest size container is the scroller,
// whose content box is the band's own width, and the band cannot be moved out
// of the scroller. So this measures it, per band, as the distance from the
// band's right and bottom edges to its view's, and writes it on the band
// (REACH). The art stretches the band's layer by it (art.ts surfaceRule): both
// copies then share the view's corner and its mask, one continuous picture.
// The stretch is clipped by the scroller, so nothing shows under the scrollbar.
//
// Event-driven, no polling: one ResizeObserver watches each band and every
// ancestor up to its view, content boxes included, so the scroller's content
// box shrinking when a classic scrollbar appears measures again, as does any
// resize of the view. A MutationObserver on the body finds bands that bb mounts
// or swaps, and looks no further than the nodes each mutation adds or removes.
import type { Targets } from "./targets.ts";

/** The custom properties the art's band layer reaches out by (px, set on each dock band). */
export const REACH = {
  right: "--lively-reach-right",
  bottom: "--lively-reach-bottom",
} as const;

export interface ReachWatcher {
  /** Look for bands now and measure every band (also runs whenever bb adds or removes one). */
  scan(): void;
  /** Measure every band now. */
  measure(): void;
  dispose(): void;
}

/** The gap from a band's edge to its view's, never negative, to a tenth of a pixel. */
const gap = (outer: number, inner: number) => `${Math.max(0, Math.round((outer - inner) * 10) / 10)}px`;

/** The band, its view and everything between them: the scroller's content box among them. */
function chain(band: Element, view: Element): Array<Element> {
  const out: Array<Element> = [];
  for (let at: Element | null = band; at !== null; at = at.parentElement) {
    out.push(at);
    if (at === view) break;
  }
  return out;
}

export function createReachWatcher(options: { readonly win: Window; readonly targets: Targets }): ReachWatcher {
  const { win, targets } = options;
  const doc = win.document;
  const realm = win as Window & typeof globalThis;
  /** Each band and the view it belongs to. */
  const bands = new Map<HTMLElement, Element>();
  let disposed = false;

  const measure = () => {
    for (const [band, view] of bands) {
      if (!band.isConnected) continue;
      const outer = view.getBoundingClientRect();
      const inner = band.getBoundingClientRect();
      band.style.setProperty(REACH.right, gap(outer.right, inner.right));
      band.style.setProperty(REACH.bottom, gap(outer.bottom, inner.bottom));
    }
  };
  // Every engine lively runs in has it; happy-dom's lays nothing out and never fires.
  const resized = new realm.ResizeObserver(() => measure());

  const scan = () => {
    if (disposed) return;
    for (const band of bands.keys()) if (!band.isConnected) bands.delete(band);
    for (const band of doc.querySelectorAll<HTMLElement>(targets.dock)) {
      const view = band.closest(targets.pageView);
      if (view !== null) bands.set(band, view);
    }
    resized.disconnect();
    for (const [band, view] of bands) for (const element of chain(band, view)) resized.observe(element);
    measure();
  };

  /** Whether a mutation added or removed a band (or a view holding one). */
  const touchesBand = (nodes: NodeList) =>
    [...nodes].some((node) => node.nodeType === 1 && ((node as Element).matches(targets.dock) || (node as Element).querySelector(targets.dock) !== null));
  const mutated = new realm.MutationObserver((records) => {
    if (records.some((record) => touchesBand(record.addedNodes) || touchesBand(record.removedNodes))) scan();
  });
  mutated.observe(doc.body, { childList: true, subtree: true });
  scan();

  return {
    scan,
    measure,
    dispose: () => {
      disposed = true;
      mutated.disconnect();
      resized.disconnect();
      for (const band of bands.keys()) {
        band.style.removeProperty(REACH.right);
        band.style.removeProperty(REACH.bottom);
      }
      bands.clear();
    },
  };
}
