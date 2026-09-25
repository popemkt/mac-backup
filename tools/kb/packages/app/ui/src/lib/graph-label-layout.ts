export interface GraphLabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whether `box` overlaps any of `occupied` (CSS pixels). */
export function overlapsGraphLabel(
  box: GraphLabelBox,
  occupied: readonly GraphLabelBox[],
): boolean {
  return occupied.some(
    (other) =>
      box.x < other.x + other.width &&
      box.x + box.width > other.x &&
      box.y < other.y + other.height &&
      box.y + box.height > other.y,
  );
}

/** Reserve labels in priority order in CSS pixels, independently of renderer. */
export function reserveGraphLabel(box: GraphLabelBox, occupied: GraphLabelBox[]): boolean {
  if (overlapsGraphLabel(box, occupied)) return false;
  occupied.push(box);
  return true;
}
