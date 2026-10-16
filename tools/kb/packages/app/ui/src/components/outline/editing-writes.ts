/**
 * The outline's own gestures over the page's write path: the writes are the
 * write path's (`mutations`), and what the outline adds is its rule for the
 * row the gesture leaves — an empty row it mints is transient, pruned when
 * focus leaves it still empty (Tana, r1 §3.3), and "the row above" is the one
 * the outline draws above (r1 D09).
 */
import { mutations } from "@/actions/mutations";
import { useOutlineStore } from "@/stores/outline.store";

/** The minted id, marked transient; null when the write was refused. */
function transient(id: string | null): string | null {
  if (id !== null) useOutlineStore.getState().markTransient(id);
  return id;
}

/**
 * Tana transient create: mint a real empty node (root, first child, or after
 * sibling), focused at offset 0, and mark it transient. Replaces the
 * detached ghost row entirely.
 */
export async function createTransientNode(
  parentId: string,
  afterSiblingId: string | null,
): Promise<string | null> {
  return transient(await mutations.createEmptyNode(parentId, afterSiblingId));
}

/** A transient sibling directly ABOVE the anchor, focused ('O' key). */
export async function createNodeBefore(beforeId: string): Promise<string | null> {
  return transient(await mutations.createEmptyNodeBefore(beforeId));
}

/**
 * Backspace-merge. With the row's instance, the target is what the outline
 * draws directly above the caret: a preceding sibling with expanded children
 * merges into its deepest last descendant.
 */
export async function mergeWithPrevious(id: string, instanceKey?: string): Promise<void> {
  const previous =
    instanceKey === undefined
      ? null
      : (useOutlineStore.getState().getPreviousVisibleInstance(instanceKey)?.nodeId ?? null);
  await mutations.mergeWithPrevious(id, previous);
}
