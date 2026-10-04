/**
 * Immutable undo/redo ring buffer for CanvasDoc snapshots.
 * Pure — no React deps; unit-tested standalone.
 */
import { stringifyCanvasDoc, withCanvasCamera, type CanvasDoc } from "@kb/canvas";

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

/** A document's content as stored, its camera left out: what an edit changes. */
const contentOf = (doc: CanvasDoc) => stringifyCanvasDoc(withCanvasCamera(doc, undefined));

/**
 * `h` having taken in `stored`, the document the store holds now. A change
 * of content made elsewhere — another tab's, an agent's canvas verb, each
 * one canvas write — is one step, which undo takes back as it takes back
 * the person's own. A change of the camera alone is view state, taken in
 * with no step, and the store echoing what is shown changes nothing.
 */
export function adoptStored(h: CanvasHistory, stored: CanvasDoc): CanvasHistory {
  if (contentOf(stored) !== contentOf(h.present)) return pushHistory(h, stored);
  if (stringifyCanvasDoc(stored) === stringifyCanvasDoc(h.present)) return h;
  return { ...h, present: stored };
}

export function undo(h: CanvasHistory): CanvasHistory {
  const past = [...h.past];
  const prev = past.pop();
  if (prev === undefined) return h;
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
