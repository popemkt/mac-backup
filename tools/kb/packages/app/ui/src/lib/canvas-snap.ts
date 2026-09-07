import type { CanvasNode } from "@kb/canvas";

/** Resolve each axis once, choosing the nearest alignment in screen pixels. */
export function snapCanvasMove(
  moving: CanvasNode,
  others: CanvasNode[],
  dx: number,
  dy: number,
  zoom: number,
) {
  const guides: { axis: "x" | "y"; pos: number }[] = [];
  const nearest = (axis: "x" | "y", delta: number) => {
    const size = axis === "x" ? "width" : "height";
    const start = moving[axis] + delta;
    let best = 5 / zoom;
    let correction = 0;
    let position: number | undefined;
    for (const other of others) {
      const pairs: [number, number][] = [
        [start, other[axis]],
        [start, other[axis] + other[size]],
        [start + moving[size], other[axis]],
        [start + moving[size], other[axis] + other[size]],
        [start + moving[size] / 2, other[axis] + other[size] / 2],
      ];
      for (const [from, to] of pairs) {
        const distance = Math.abs(to - from);
        if (distance < best) {
          best = distance;
          correction = to - from;
          position = to;
        }
      }
    }
    if (position !== undefined) guides.push({ axis, pos: position });
    return delta + correction;
  };
  return { dx: nearest("x", dx), dy: nearest("y", dy), guides };
}
