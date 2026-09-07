/**
 * What each editing intent does, one named step per intent type.
 *
 * The effectful half of the outline's editing contract: {@link ./editing-keymap}
 * decides which intent a chord means, and these steps carry it out against the
 * store, the mutations and — for the soft break, which rewrites the live
 * element — the contenteditable host.
 *
 * Exhaustiveness is the mapped type: a new `EditingIntent` variant with no row
 * here fails the build.
 */
import { mutations } from "@/actions/mutations";
import { renderEditableContent, setCaretSerializedOffset } from "@/lib/md-edit";
import { useOutlineStore } from "@/stores/outline.store";
import type { EditingIntent } from "./editing-keymap";

type IntentOf<T extends EditingIntent["type"]> = Extract<EditingIntent, { type: T }>;

type EditingSteps = {
  [T in EditingIntent["type"]]: (intent: IntentOf<T>, editable: HTMLElement) => void;
};

/** A soft break rewrites the live element as well as the node. */
function softBreak(
  { nodeId, instanceKey, cursor }: IntentOf<"softBreak">,
  editable: HTMLElement,
): void {
  const store = useOutlineStore.getState();
  const text = store.nodes.get(nodeId)?.text ?? "";
  const next = `${text.slice(0, cursor)}\n${text.slice(cursor)}`;
  void mutations.updateNodeContent(nodeId, next);
  renderEditableContent(editable, next);
  setCaretSerializedOffset(editable, cursor + 1);
  store.activateNode(nodeId, cursor + 1, instanceKey);
}

/**
 * Delete the subtree, then put the caret on the previous visible row at its
 * text end — or on the next row at its start, or nowhere when neither exists.
 */
function deleteSubtree({ nodeId, instanceKey }: IntentOf<"deleteSubtree">): void {
  const store = useOutlineStore.getState();
  const prev = store.getPreviousVisibleInstance(instanceKey);
  const next = store.getNextVisibleInstance(instanceKey);
  void mutations.deleteNode(nodeId).then(() => {
    const pick = prev ?? next;
    if (!pick) {
      useOutlineStore.getState().selectNode(null);
      return;
    }
    const picked = useOutlineStore.getState().nodes.get(pick.nodeId);
    const at = pick === prev ? (picked?.text.length ?? 0) : 0;
    useOutlineStore.getState().activateNode(pick.nodeId, at, pick.instanceKey);
  });
}

/** An empty leaf: delete it and focus the end of the previous visible row. */
function deleteEmptyRow({ nodeId, instanceKey }: IntentOf<"deleteEmptyRow">): void {
  const prev = useOutlineStore.getState().getPreviousVisibleInstance(instanceKey);
  void mutations.deleteNode(nodeId).then(() => {
    if (!prev) return;
    const store = useOutlineStore.getState();
    store.activateNode(
      prev.nodeId,
      store.nodes.get(prev.nodeId)?.text.length ?? 0,
      prev.instanceKey,
    );
  });
}

function mergeNextIn({ nodeId, instanceKey, nextNodeId, caret }: IntentOf<"mergeNextIn">): void {
  void mutations.mergeNextIntoThis(nodeId, nextNodeId).then(() => {
    useOutlineStore.getState().activateNode(nodeId, caret, instanceKey);
  });
}

const EDITING_STEPS: EditingSteps = {
  claim: () => {},
  softBreak,
  split: ({ nodeId, cursor }) => void mutations.splitNode(nodeId, cursor),
  indent: ({ nodeId, cursor }) => void mutations.indentNode(nodeId, cursor),
  outdent: ({ nodeId, cursor }) => void mutations.outdentNode(nodeId, cursor),
  deleteSubtree,
  deleteEmptyRow,
  mergeIntoPrevious: ({ nodeId, instanceKey }) =>
    void mutations.mergeWithPrevious(nodeId, instanceKey),
  mergeNextIn,
  moveUp: ({ nodeId }) => void mutations.moveNodeUp(nodeId),
  moveDown: ({ nodeId }) => void mutations.moveNodeDown(nodeId),
  toggleCollapse: ({ nodeId }) => useOutlineStore.getState().toggleCollapse(nodeId),
  // Collapsed / leaf: jump to the enclosing page (zoomed root).
  zoomToParent: ({ parentId }) => useOutlineStore.getState().zoomTo(parentId),
  moveCaretToRow: ({ nodeId, instanceKey, cursor, x }) =>
    useOutlineStore.getState().activateNode(nodeId, cursor, instanceKey, { x }),
  select: ({ nodeId, instanceKey }) => useOutlineStore.getState().selectNode(nodeId, instanceKey),
};

/**
 * Run the step for `intent`.
 *
 * Generic in the intent's own `type` so the indexed call needs no cast: the
 * table entry and the intent are correlated by construction.
 */
export function applyEditingIntent<T extends EditingIntent["type"]>(
  intent: IntentOf<T>,
  editable: HTMLElement,
): void {
  EDITING_STEPS[intent.type](intent, editable);
}
