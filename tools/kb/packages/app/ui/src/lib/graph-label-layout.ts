/**
 * The graph renderers' one label layout (DESIGN-UI.md → Graph → Look and
 * motion): labels are placed in priority order, and a label that would
 * overlap a drawn node or a label already placed is left out. Priority is
 * stated once here — the node in focus first, then the best-connected, then a
 * stable order by id — so a hub such as "kb" is labelled before the leaves
 * around it in every renderer that draws labels.
 */
export interface GraphLabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What decides a label's place in the queue. */
export interface GraphLabelRank {
  readonly id: string;
  readonly degree: number;
  /** 0–1: how much the node is in focus (selected, else hovered). */
  readonly focus?: number;
}

/** Label priority: focus, then degree, then id. Sort ascending with it. */
export function byLabelPriority(a: GraphLabelRank, b: GraphLabelRank): number {
  return (
    (b.focus ?? 0) - (a.focus ?? 0) ||
    b.degree - a.degree ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
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
