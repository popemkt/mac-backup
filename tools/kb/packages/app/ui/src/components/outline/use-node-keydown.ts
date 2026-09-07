import { useCallback } from "react";
import { getCaretSerializedOffset } from "@/lib/md-edit";
import { useOutlineStore } from "@/stores/outline.store";
import { readCaretGeometry, verticalArrowDecision, type VerticalNavDecision } from "@/lib/caret";
import { applyEditingIntent } from "./editing-intents";
import { mapEditingKey, type EditingKeyContext } from "./editing-keymap";

export interface UseNodeKeyDownArgs {
  nodeId: string;
  instanceKey: string;
  isRef?: boolean;
}

/** The row as the keymap needs to see it, read from the store and the DOM. */
function readEditingContext(args: {
  nodeId: string;
  instanceKey: string;
  isRef: boolean;
  editable: HTMLElement;
}): EditingKeyContext {
  const { nodeId, instanceKey, isRef, editable } = args;
  const store = useOutlineStore.getState();
  const live = store.nodes.get(nodeId);
  const parentId = live?.parentId ?? null;
  const parent = parentId === null ? undefined : store.nodes.get(parentId);
  return {
    isRef,
    nodeId,
    instanceKey,
    // Serialized caret offset — robust across element boundaries and atomic
    // ref pills (D06).
    cursor: getCaretSerializedOffset(editable),
    text: live?.text ?? "",
    childCount: live?.children.length ?? 0,
    collapsed: live?.collapsed ?? false,
    tagCount: live?.tags.length ?? 0,
    parentId,
    siblingIndex: parent ? parent.children.indexOf(nodeId) : -1,
    previousInstance: store.getPreviousVisibleInstance(instanceKey),
    nextInstance: store.getNextVisibleInstance(instanceKey),
    textLengthOf: (id) => store.nodes.get(id)?.text.length ?? 0,
    readVerticalDecision: (key): VerticalNavDecision =>
      verticalArrowDecision({
        key: key === "ArrowUp" ? "ArrowUp" : "ArrowDown",
        geometry: readCaretGeometry(editable),
      }),
  };
}

/**
 * Mode A structural keymap (r1 §3.2) — shared by list rows and table cells.
 *
 * Three parts, each with one job: read the row's shape, map the chord to an
 * intent ({@link ./editing-keymap}), carry the intent out
 * ({@link ./editing-intents}). Vertical navigation reads visual-line geometry,
 * never naive extremes, and an intent always claims the key.
 */
export function useNodeKeyDown({ nodeId, instanceKey, isRef = false }: UseNodeKeyDownArgs) {
  return useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const editable = e.currentTarget;
      const intent = mapEditingKey(
        {
          key: e.key,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
        },
        readEditingContext({ nodeId, instanceKey, isRef, editable }),
      );
      if (intent === null) return;
      e.preventDefault();
      applyEditingIntent(intent, editable);
    },
    [nodeId, isRef, instanceKey],
  );
}
