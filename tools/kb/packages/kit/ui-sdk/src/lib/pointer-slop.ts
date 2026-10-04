/**
 * How far a press may travel and still be a click (a tap), not a drag: one
 * slop for every surface that tells the two apart — the canvas's card,
 * resize and marquee drags, the scene kit's taps, and a graph node's drag
 * (`graph-drag`) — so a press is never both.
 */
export const POINTER_SLOP = 4;

/** Whether a press that has travelled (dx, dy) CSS px is a drag. */
export const pastSlop = (dx: number, dy: number): boolean => Math.hypot(dx, dy) > POINTER_SLOP;
