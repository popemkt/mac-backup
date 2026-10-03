import { useLayoutEffect, useRef } from "react";

/** Scroll offsets of bodies taken off screen, put back when they are placed again. */
const scrolled = new WeakMap<HTMLElement, number>();

const regionOf = (body: HTMLElement): HTMLElement | null =>
  body.querySelector<HTMLElement>("[data-main-region]");

/**
 * Where a pane's body sits on screen (`usePaneBodies`): it places the body's
 * element, and takes it back. The pane's scroll offset, its ephemeral state,
 * is put back after a move.
 */
export function PaneMount({ element }: { readonly element: HTMLElement }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = host.current;
    if (box === null) return undefined;
    box.append(element);
    const region = regionOf(element);
    const top = scrolled.get(element);
    if (region !== null && top !== undefined) region.scrollTop = top;
    return () => {
      const leaving = regionOf(element);
      if (leaving !== null) scrolled.set(element, leaving.scrollTop);
      if (element.parentNode === box) element.remove();
    };
  }, [element]);
  return <div ref={host} className="flex h-full min-h-0 min-w-0 flex-1 flex-col" />;
}
