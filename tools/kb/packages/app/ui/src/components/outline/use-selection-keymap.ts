import { useEffect } from "react";
import { isEditableTarget, mapSelectionKey } from "@/lib/selection-keymap";
import { useOutlineStore } from "@/stores/outline.store";
import { applySelectionAction } from "./selection-actions";

/** Window-level selection-mode keymap while a node is selected (not editing). */
export function useSelectionKeymap(): void {
  const selectedNodeId = useOutlineStore((s) => s.selectedNodeId);
  const selectedInstanceKey = useOutlineStore((s) => s.selectedInstanceKey);
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);

  useEffect(() => {
    if (selectedNodeId === null || selectedInstanceKey === null || activeNodeId !== null)
      return undefined;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && !(e.metaKey || e.ctrlKey)) {
        if (e.key.length === 1) return; // Alt-composed glyphs stay native
      }
      if (isEditableTarget(e.target)) return;

      const store = useOutlineStore.getState();
      const action = mapSelectionKey(
        {
          key: e.key,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
        },
        {
          selectedNodeId: store.selectedNodeId,
          selectedInstanceKey: store.selectedInstanceKey,
          activeNodeId: store.activeNodeId,
          getPreviousVisibleInstance: store.getPreviousVisibleInstance,
          getNextVisibleInstance: store.getNextVisibleInstance,
          getNode: (id) => {
            const n = store.nodes.get(id);
            if (!n) return undefined;
            return {
              collapsed: n.collapsed,
              childIds: n.children,
              parentId: n.parentId,
            };
          },
        },
      );
      if (!action) return;
      e.preventDefault();
      applySelectionAction(action);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNodeId, selectedInstanceKey, activeNodeId]);
}
