import { useEffect } from "react";
import { mutations } from "@/actions/mutations";
import { isEditableTarget, mapSelectionKey, type SelectionKeyAction } from "@/lib/selection-keymap";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
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
    case "collapse":
    case "expand":
      store.toggleCollapse(action.nodeId);
      break;
    case "selectParent": {
      const parent = store.nodes.get(action.nodeId)?.parentId ?? null;
      if (parent) {
        store.selectNode(parent);
        requestAnimationFrame(() => {
          document
            .querySelector(`[data-node-id="${CSS.escape(parent)}"]`)
            ?.scrollIntoView({ block: "nearest" });
        });
      }
      break;
    }
    case "selectFirstChild": {
      const first = store.nodes.get(action.nodeId)?.children[0];
      if (first) store.selectNode(first);
      break;
    }
    case "indent":
      void mutations.indentNode(action.nodeId);
      break;
    case "outdent":
      void mutations.outdentNode(action.nodeId);
      break;
    case "moveUp":
      void mutations.moveNodeUp(action.nodeId);
      break;
    case "moveDown":
      void mutations.moveNodeDown(action.nodeId);
      break;
    case "zoom":
      store.zoomTo(action.nodeId);
      break;
    case "createAfter": {
      // 'o': directly below = first child when expanded, else next sibling.
      const n = store.nodes.get(action.nodeId);
      const expanded = Boolean(n && !n.collapsed && n.children.length > 0);
      if (expanded) {
        void mutations.createTransientNode(action.nodeId, null);
      } else {
        void mutations.createTransientNode(n?.parentId ?? WORKSPACE_ROOT_ID, action.nodeId);
      }
      break;
    }
    case "createBefore":
      void mutations.createNodeBefore(action.nodeId);
      break;
    case "append": {
      // Printable char: activate at text end with the character appended.
      const node = store.nodes.get(action.nodeId);
      const nextText = (node?.text ?? "") + action.char;
      store.activateNode(action.nodeId, nextText.length, action.instanceKey);
      mutations.updateNodeContent(action.nodeId, nextText);
      break;
    }
    case "delete": {
      const prev = store.getPreviousVisibleInstance(action.instanceKey);
      const next = store.getNextVisibleInstance(action.instanceKey);
      // oxlint-disable-next-line promise/always-return -- GAP [[01M1MFS8RQ2BMQVZD02J4TQT7W]]
      void mutations.deleteNode(action.nodeId).then(() => {
        const pick = prev ?? next;
        if (pick) {
          useOutlineStore.getState().selectNode(pick.nodeId, pick.instanceKey);
        } else {
          useOutlineStore.getState().selectNode(null);
        }
      });
      break;
    }
    // Exhaustive over SelectionKeyAction; switch-exhaustiveness-check guards it
    // no default
  }
}

/** Window-level selection-mode keymap while a node is selected (not editing). */
export function useSelectionKeymap(): void {
  const selectedNodeId = useOutlineStore((s) => s.selectedNodeId);
  const selectedInstanceKey = useOutlineStore((s) => s.selectedInstanceKey);
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);

  useEffect(() => {
    if (!selectedNodeId || !selectedInstanceKey || activeNodeId) return undefined;

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
