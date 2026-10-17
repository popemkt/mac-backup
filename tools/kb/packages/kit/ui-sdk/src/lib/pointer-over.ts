/**
 * The pointer over a frame, as one declared input (DESIGN-UI.md → Page-head
 * backdrops). A frame that is `pointer-events: none` receives no pointer
 * events, so the one listener sits on the smallest ancestor whose box covers
 * the frame, and reports the pointer relative to the frame, or none when it
 * is outside it. A reader polls `now()` in its own loop: the source never
 * re-renders anyone, however the pointer moves, and `now()` reads no layout,
 * so polling it every frame forces none.
 */
import { useEffect, useRef, useState, type RefObject } from "react";

export interface PointerPlace {
  /** CSS pixels from the frame's top-left corner. */
  readonly x: number;
  readonly y: number;
}

export interface PointerSource {
  /** Where the pointer is over the frame now; null when it is not over it. */
  readonly now: () => PointerPlace | null;
}

/** The nearest ancestor of `frame` whose box covers the frame's own, else the document element. */
function coveringAncestor(frame: HTMLElement): HTMLElement {
  const box = frame.getBoundingClientRect();
  for (let up = frame.parentElement; up !== null; up = up.parentElement) {
    const outer = up.getBoundingClientRect();
    if (
      outer.left <= box.left &&
      outer.top <= box.top &&
      outer.right >= box.right &&
      outer.bottom >= box.bottom
    ) {
      return up;
    }
  }
  return frame.ownerDocument.documentElement;
}

/** The place `client` has over `box`, or null outside it. */
export function placeOver(
  box: Pick<DOMRect, "left" | "top" | "width" | "height">,
  client: { readonly x: number; readonly y: number },
): PointerPlace | null {
  const x = client.x - box.left;
  const y = client.y - box.top;
  return x < 0 || y < 0 || x > box.width || y > box.height ? null : { x, y };
}

/** A pointer source that is followed until it is stopped. */
export interface PointerTracker extends PointerSource {
  readonly stop: () => void;
}

/**
 * Follow the pointer over `frame` until stopped. The frame's box is measured
 * when the pointer moves, when anything scrolls, and when the frame's box
 * changes size, and `now()` reads only that measure. A change of the frame's
 * box also resolves again what covers it, since the layout around it moved.
 */
export function trackPointerOver(frame: HTMLElement): PointerTracker {
  let client: { x: number; y: number } | null = null;
  let box = frame.getBoundingClientRect();
  let cover: HTMLElement | null = null;
  const measure = () => {
    box = frame.getBoundingClientRect();
  };
  const move = (event: PointerEvent) => {
    client = { x: event.clientX, y: event.clientY };
    measure();
  };
  const leave = () => {
    client = null;
  };
  const unlisten = () => {
    cover?.removeEventListener("pointermove", move);
    cover?.removeEventListener("pointerleave", leave);
  };
  const listen = () => {
    const next = coveringAncestor(frame);
    if (next === cover) return;
    unlisten();
    next.addEventListener("pointermove", move, { passive: true });
    next.addEventListener("pointerleave", leave, { passive: true });
    cover = next;
  };
  listen();
  const view = frame.ownerDocument.defaultView;
  view?.addEventListener("scroll", measure, { capture: true, passive: true });
  const observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          measure();
          listen();
        });
  observer?.observe(frame);
  return {
    now: () => (client === null ? null : placeOver(box, client)),
    stop: () => {
      observer?.disconnect();
      view?.removeEventListener("scroll", measure, { capture: true });
      unlisten();
      client = null;
    },
  };
}

/** A pointer source over `frame`: one passive listener, on what covers it, while it is mounted. */
export function usePointerOver(frame: RefObject<HTMLElement | null>): PointerSource {
  const tracker = useRef<PointerTracker | null>(null);
  const [source] = useState<PointerSource>(() => ({
    now: () => tracker.current?.now() ?? null,
  }));
  useEffect(() => {
    const element = frame.current;
    if (element === null) return undefined;
    const tracking = trackPointerOver(element);
    tracker.current = tracking;
    return () => {
      tracking.stop();
      tracker.current = null;
    };
  }, [frame]);
  return source;
}
