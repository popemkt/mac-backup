/**
 * Immutable undo/redo ring buffer for CanvasDoc snapshots.
 * Pure — no React deps; unit-tested standalone.
 */
import type { CanvasDoc } from "@kb/canvas";

const MAX_HISTORY = 30;

export interface CanvasHistory {
  past: CanvasDoc[];
  present: CanvasDoc;
  future: CanvasDoc[];
}

export function initHistory(doc: CanvasDoc): CanvasHistory {
  return { past: [], present: doc, future: [] };
}

/**
 * Push a new snapshot. Clears future (redo) stack.
 * Skips if `next` is reference-equal to `present` (avoids identity pushes).
 */
export function pushHistory(h: CanvasHistory, next: CanvasDoc): CanvasHistory {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  if (past.length > MAX_HISTORY) past.shift();
  return { past, present: next, future: [] };
}

export function undo(h: CanvasHistory): CanvasHistory {
  if (h.past.length === 0) return h;
  const past = [...h.past];
  const prev = past.pop()!;
  return { past, present: prev, future: [h.present, ...h.future] };
}

export function redo(h: CanvasHistory): CanvasHistory {
  const [next, ...rest] = h.future;
  if (!next) return h;
  return { past: [...h.past, h.present], present: next, future: rest };
}
export function canUndo(h: CanvasHistory): boolean {
  return h.past.length > 0;
}

export function canRedo(h: CanvasHistory): boolean {
  return h.future.length > 0;
}
