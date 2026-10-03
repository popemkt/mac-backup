/**
 * The outline host a point of the tree belongs to, and which of the outlines
 * on screen leads. Several outlines can be on screen at once, one per pane:
 * each keys its rows under its pane's host (`outlineHostOfPane`), and the
 * page-wide parts of editing — the selection keymap, undo, the node palette —
 * exist once, owned by the outline that leads: the first one mounted that is
 * still on screen.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { outlineHostOfPane } from "@/lib/instance-key";
import { usePane } from "@/lib/pane";

/** The outline host of the pane the caller is drawn in. */
export function useOutlineHost(): string {
  return outlineHostOfPane(usePane());
}

const mounted: symbol[] = [];
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed(): void {
  for (const listener of listeners) listener();
}

/** Whether the calling outline leads: true for exactly one mounted outline. */
export function useLeadsOutlines(): boolean {
  const [me] = useState(() => Symbol("outline"));
  useEffect(() => {
    mounted.push(me);
    changed();
    return () => {
      mounted.splice(mounted.indexOf(me), 1);
      changed();
    };
  }, [me]);
  return useSyncExternalStore(
    subscribe,
    () => mounted[0] === me,
    () => false,
  );
}
