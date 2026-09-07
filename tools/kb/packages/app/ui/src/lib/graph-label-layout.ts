export interface GraphLabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Reserve labels in priority order in CSS pixels, independently of renderer. */
export function reserveGraphLabel(box: GraphLabelBox, occupied: GraphLabelBox[]): boolean {
  if (
    occupied.some(
      (other) =>
        box.x < other.x + other.width &&
        box.x + box.width > other.x &&
        box.y < other.y + other.height &&
        box.y + box.height > other.y,
    )
  )
    return false;
  occupied.push(box);
  return true;
}
