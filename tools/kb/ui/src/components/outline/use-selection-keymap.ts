import { useEffect } from "react";
import { mutations } from "@/actions/mutations";
import {
  isEditableTarget,
  mapSelectionKey,
  type SelectionKeyAction,
} from "@/lib/selection-keymap";
import { useOutlineStore } from "@/stores/outline.store";

function applySelectionAction(action: SelectionKeyAction): void {
  const store = useOutlineStore.getState();
  switch (action.type) {
    case "select":
      store.selectNode(action.nodeId, action.instanceKey);
      break;
    case "clear":
      store.selectNode(null);
      break;
    case "edit":
      store.activateNode(action.nodeId, 0, action.instanceKey);
      break;
    case "toggleCollapse":
      store.toggleCollapse(action.nodeId);
      break;
    case "createAfter":
      void mutations.createNodeAfter(action.nodeId);
      break;
    case "delete": {
      const prev = store.getPreviousVisibleInstance(action.instanceKey);
      const next = store.getNextVisibleInstance(action.instanceKey);
      void mutations.deleteNode(action.nodeId).then(() => {
        const pick = prev ?? next;
        if (pick) {
          useOutlineStore
            .getState()
            .selectNode(pick.nodeId, pick.instanceKey);
        } else {
          useOutlineStore.getState().selectNode(null);
        }
      });
      break;
    }
  }
}

/** Window-level selection-mode keymap while a node is selected (not editing). */
export function useSelectionKeymap(): void {
  const selectedNodeId = useOutlineStore((s) => s.selectedNodeId);
  const selectedInstanceKey = useOutlineStore((s) => s.selectedInstanceKey);
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);

  useEffect(() => {
    if (!selectedNodeId || !selectedInstanceKey || activeNodeId) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      const store = useOutlineStore.getState();
      const action = mapSelectionKey(e.key, {
        selectedNodeId: store.selectedNodeId,
        selectedInstanceKey: store.selectedInstanceKey,
        activeNodeId: store.activeNodeId,
        getPreviousVisibleInstance: store.getPreviousVisibleInstance,
        getNextVisibleInstance: store.getNextVisibleInstance,
      });
      if (!action) return;
      e.preventDefault();
      applySelectionAction(action);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNodeId, selectedInstanceKey, activeNodeId]);
}
