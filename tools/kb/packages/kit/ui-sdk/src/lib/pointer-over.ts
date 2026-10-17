/**
 * The pointer over a frame, as one declared input (DESIGN-UI.md → Page-head
 * backdrops). A frame that is `pointer-events: none` receives no pointer
 * events, so the one listener sits on the smallest ancestor whose box covers
 * the frame, and reports the pointer relative to the frame, or none when it
 * is outside it. A reader polls `now()` in its own loop: the source never
 * re-renders anyone, however the pointer moves.
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

/** A pointer source over `frame`: one passive listener, on what covers it, while it is mounted. */
export function usePointerOver(frame: RefObject<HTMLElement | null>): PointerSource {
  const client = useRef<{ x: number; y: number } | null>(null);
  const [source] = useState<PointerSource>(() => ({
    now: () => {
      const element = frame.current;
      const at = client.current;
      return element === null || at === null
        ? null
        : placeOver(element.getBoundingClientRect(), at);
    },
  }));
  useEffect(() => {
    const element = frame.current;
    if (element === null) return undefined;
    const cover = coveringAncestor(element);
    const move = (event: PointerEvent) => {
      client.current = { x: event.clientX, y: event.clientY };
    };
    const leave = () => {
      client.current = null;
    };
    cover.addEventListener("pointermove", move, { passive: true });
    cover.addEventListener("pointerleave", leave, { passive: true });
    return () => {
      cover.removeEventListener("pointermove", move);
      cover.removeEventListener("pointerleave", leave);
      client.current = null;
    };
  }, [frame]);
  return source;
}
