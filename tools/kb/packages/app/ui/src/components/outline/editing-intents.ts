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
import { rowTextOf } from "@/lib/contextual-ref";
import { renderInlineMarkdown, serializeEditable, setCaretSerializedOffset } from "@/lib/md-edit";
import { schemaOf } from "@/lib/schema";
import { refInkOf } from "@/lib/tag-color";
import { useOutlineStore } from "@/stores/outline.store";
import { enterFields } from "@/lib/value-slot-nav";
import type { EditingIntent } from "./editing-keymap";

type IntentOf<T extends EditingIntent["type"]> = Extract<EditingIntent, { type: T }>;

type EditingSteps = {
  [T in EditingIntent["type"]]: (intent: IntentOf<T>, editable: HTMLElement) => void;
};

/**
 * A soft break is typed into the live element like any character: it breaks
 * the text the element holds (which may be ahead of the store), and the
 * element hears it as input, so its host records the write as its own.
 */
function softBreak(
  { nodeId, instanceKey, cursor }: IntentOf<"softBreak">,
  editable: HTMLElement,
): void {
  const store = useOutlineStore.getState();
  // The row's text channel: a reference's break lands in its original.
  const { textNodeId } = rowTextOf(store, nodeId);
  const text = serializeEditable(editable);
  const next = `${text.slice(0, cursor)}\n${text.slice(cursor)}`;
  renderInlineMarkdown(editable, next, refInkOf(schemaOf(store)));
  setCaretSerializedOffset(editable, cursor + 1);
  const view = editable.ownerDocument.defaultView;
  if (view) editable.dispatchEvent(new view.Event("input", { bubbles: true }));
  void mutations.updateNodeContent(textNodeId, next);
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
    const at = pick === prev ? rowTextOf(useOutlineStore.getState(), pick.nodeId).text.length : 0;
    useOutlineStore.getState().activateNode(pick.nodeId, at, pick.instanceKey);
  });
}

/** An empty leaf: delete it and focus the end of the previous visible row. */
function deleteEmptyRow({ nodeId, instanceKey }: IntentOf<"deleteEmptyRow">): void {
  const prev = useOutlineStore.getState().getPreviousVisibleInstance(instanceKey);
  void mutations.deleteNode(nodeId).then(() => {
    if (!prev) return;
    const store = useOutlineStore.getState();
    store.activateNode(prev.nodeId, rowTextOf(store, prev.nodeId).text.length, prev.instanceKey);
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
  enterFields: ({ instanceKey, which }) => void enterFields(instanceKey, which),
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
