import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/** The gap between an anchor and what floats from it, and the viewport margin. */
const GAP = 4;
const MARGIN = 8;
/** Below the anchor is the reading direction: flip only when there is less room than this. */
const ROOM_TO_STAY = 180;

/**
 * Where a floating panel (a picker's list, a calendar) sits next to its
 * anchor: below it, flipped above only when the room below is short and there
 * is more above,
 * clamped inside the viewport horizontally, its height capped to the room it
 * has. `position: fixed`, so a scrolling or clipping ancestor (a table cell,
 * a board column) neither clips nor shifts it.
 *
 * Until it has measured — on the server, or in the commit that opens it —
 * this returns undefined and the panel keeps its in-flow fallback placement.
 */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  open: boolean,
): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const anchor = anchorRef.current;
      const floating = floatingRef.current;
      if (anchor === null || floating === null) return;
      const r = anchor.getBoundingClientRect();
      const width = floating.offsetWidth;
      const height = floating.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const below = r.bottom + GAP;
      const roomBelow = vh - MARGIN - below;
      const roomAbove = r.top - GAP - MARGIN;
      const flip = height > roomBelow && roomBelow < ROOM_TO_STAY && roomAbove > roomBelow;
      const room = Math.max(flip ? roomAbove : roomBelow, 0);
      const shown = Math.min(height, room);
      setStyle({
        position: "fixed",
        top: flip ? r.top - GAP - shown : below,
        left: Math.max(MARGIN, Math.min(r.left, vw - MARGIN - width)),
        maxHeight: room,
      });
    };
    place();
    // The panel's own size changes with what it shows (a list narrowing).
    const observer =
      typeof ResizeObserver === "undefined" || floatingRef.current === null
        ? null
        : new ResizeObserver(place);
    if (observer !== null && floatingRef.current !== null) observer.observe(floatingRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, floatingRef, open]);

  return open ? style : undefined;
}
