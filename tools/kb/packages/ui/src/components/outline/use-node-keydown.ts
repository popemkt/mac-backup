import { useCallback } from "react";
import { mutations } from "@/actions/mutations";
import {
  getCaretSerializedOffset,
  renderEditableContent,
  setCaretSerializedOffset,
} from "@/lib/md-edit";
import type { OutlineNode } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { readCaretGeometry, verticalArrowDecision } from "./caret";

export interface UseNodeKeyDownArgs {
  nodeId: string;
  instanceKey: string;
  node: OutlineNode | undefined;
  isRef?: boolean;
}

/**
 * Mode A structural keymap (r1 §3.2) — shared by list rows and table cells.
 * Offsets are SERIALIZED character offsets (pills count as their token), and
 * vertical navigation reads visual-line geometry, never naive extremes.
 */
export function useNodeKeyDown({ nodeId, instanceKey, isRef = false }: UseNodeKeyDownArgs) {
  const activateNode = useOutlineStore((s) => s.activateNode);
  const toggleCollapse = useOutlineStore((s) => s.toggleCollapse);

  return useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const store = useOutlineStore.getState();
      const live = store.nodes.get(nodeId);
      const el = e.currentTarget;

      // Serialized caret offset — robust across element boundaries and
      // atomic ref pills (D06).
      const cursor = getCaretSerializedOffset(el);

      if (isRef) {
        const structural =
          e.key === "Tab" ||
          (e.key === "Enter" && !e.shiftKey) ||
          ((e.key === "Backspace" || e.key === "Delete") && (e.metaKey || e.ctrlKey)) ||
          (e.key === "Backspace" && cursor === 0) ||
          ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.metaKey && e.shiftKey);
        if (structural) {
          e.preventDefault();
          return;
        }
      }

      const text = live?.text ?? "";
      const parentId = live?.parentId ?? null;
      const parentNode = parentId ? store.nodes.get(parentId) : null;
      const siblingIdx = parentNode ? parentNode.children.indexOf(nodeId) : -1;

      switch (e.key) {
        case "Enter": {
          if (e.shiftKey) {
            // Soft line break inside the node — never a split (§3.2).
            e.preventDefault();
            const next = text.slice(0, cursor) + "\n" + text.slice(cursor);
            mutations.updateNodeContent(nodeId, next);
            renderEditableContent(el, next);
            setCaretSerializedOffset(el, cursor + 1);
            activateNode(nodeId, cursor + 1, instanceKey);
            return;
          }
          e.preventDefault();
          // Expanded parent ⇒ first child; otherwise sibling-after (D07).
          void mutations.splitNode(nodeId, cursor);
          return;
        }

        case "Tab": {
          e.preventDefault();
          if (e.shiftKey) void mutations.outdentNode(nodeId, cursor);
          else void mutations.indentNode(nodeId, cursor);
          return;
        }

        case "Backspace": {
          if (cursor !== 0) return; // native char delete
          if (e.metaKey || e.ctrlKey) {
            // Delete subtree; focus previous visible at text end, else next.
            e.preventDefault();
            const prev = store.getPreviousVisibleInstance(instanceKey);
            const nextInst = store.getNextVisibleInstance(instanceKey);
            void mutations.deleteNode(nodeId).then(() => {
              const pick = prev ?? nextInst;
              if (!pick) {
                useOutlineStore.getState().selectNode(null);
                return;
              }
              const pickNode = useOutlineStore.getState().nodes.get(pick.nodeId);
              const at = pick === prev ? (pickNode?.text.length ?? 0) : 0;
              useOutlineStore.getState().activateNode(pick.nodeId, at, pick.instanceKey);
            });
            return;
          }

          // Empty leaf anywhere: delete + focus previous visible end.
          if (text === "" && (live?.children.length ?? 0) === 0) {
            e.preventDefault();
            const prev = store.getPreviousVisibleInstance(instanceKey);
            void mutations.deleteNode(nodeId).then(() => {
              if (!prev) return;
              const prevNode = useOutlineStore.getState().nodes.get(prev.nodeId);
              useOutlineStore
                .getState()
                .activateNode(prev.nodeId, prevNode?.text.length ?? 0, prev.instanceKey);
            });
            return;
          }

          // First child (or root-level): outdent, NEVER swallow (D08).
          if (siblingIdx === 0) {
            e.preventDefault();
            void mutations.outdentNode(nodeId, cursor);
            return;
          }

          // Deeper than first child: merge into the VISIBLE predecessor
          // (deepest last descendant of the array sibling) — D09.
          if (siblingIdx > 0) {
            e.preventDefault();
            void mutations.mergeWithPrevious(nodeId, instanceKey);
            return;
          }
          // Forest top edge: nothing above; keep native no-op.
          return;
        }

        case "Delete": {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            const prev = store.getPreviousVisibleInstance(instanceKey);
            const nextInst = store.getNextVisibleInstance(instanceKey);
            void mutations.deleteNode(nodeId).then(() => {
              const pick = prev ?? nextInst;
              if (!pick) {
                useOutlineStore.getState().selectNode(null);
                return;
              }
              const pickNode = useOutlineStore.getState().nodes.get(pick.nodeId);
              const at = pick === prev ? (pickNode?.text.length ?? 0) : 0;
              useOutlineStore.getState().activateNode(pick.nodeId, at, pick.instanceKey);
            });
            return;
          }
          // F13: forward-delete at end merges the next visible row into this one.
          if (cursor !== text.length) return; // mid-text: native delete char
          const nextInst = store.getNextVisibleInstance(instanceKey);
          if (!nextInst || nextInst.nodeId === nodeId) return;
          e.preventDefault();
          // Merge next row's text/children into this row.
          void mutations.mergeNextIntoThis(nodeId, nextInst.nodeId).then(() => {
            useOutlineStore.getState().activateNode(nodeId, text.length, instanceKey);
          });
          return;
        }

        case "ArrowUp":
        case "ArrowDown": {
          if (e.metaKey && e.shiftKey) {
            e.preventDefault();
            if (e.key === "ArrowUp") void mutations.moveNodeUp(nodeId);
            else void mutations.moveNodeDown(nodeId);
            return;
          }
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            if (e.key === "ArrowUp") {
              if (live && live.children.length > 0 && !live.collapsed) {
                toggleCollapse(nodeId);
              } else if (parentId) {
                // Collapsed / leaf: jump to enclosing page (zoomed root).
                store.zoomTo(parentId);
              }
            } else if (
              live &&
              live.collapsed &&
              (live.children.length > 0 || live.tags.length > 0)
            ) {
              toggleCollapse(nodeId);
            }
            return;
          }

          // Visual-line vertical navigation (D10/D11).
          const decision = verticalArrowDecision({
            key: e.key,
            geometry: readCaretGeometry(el),
          });
          if (decision.kind === "within") return; // native line move
          const neighbor =
            decision.direction === -1
              ? store.getPreviousVisibleInstance(instanceKey)
              : store.getNextVisibleInstance(instanceKey);
          if (!neighbor) return; // document edge: native no-op
          e.preventDefault();
          const nNode = store.nodes.get(neighbor.nodeId);
          const fallbackCursor = decision.direction === -1 ? (nNode?.text.length ?? 0) : 0;
          activateNode(neighbor.nodeId, fallbackCursor, neighbor.instanceKey, { x: decision.x });
          return;
        }

        case "Escape": {
          // Popups handle Escape before delegating; bare Escape selects.
          e.preventDefault();
          store.selectNode(nodeId, instanceKey);
          return;
        }

        default:
          return;
      }
    },
    [nodeId, isRef, instanceKey, toggleCollapse, activateNode],
  );
}
