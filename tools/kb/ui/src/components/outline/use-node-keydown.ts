import { useCallback } from "react";
import { mutations } from "@/actions/mutations";
import type { OutlineNode } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";

export interface UseNodeKeyDownArgs {
  nodeId: string;
  instanceKey: string;
  node: OutlineNode | undefined;
  isRef?: boolean;
}

/**
 * Shared structural keymap for outline name editing (list + table).
 * Owned once so TableView name cells keep parity with NodeBlock.
 */
export function useNodeKeyDown({
  nodeId,
  instanceKey,
  node,
  isRef = false,
}: UseNodeKeyDownArgs) {
  const activateNode = useOutlineStore((s) => s.activateNode);
  const toggleCollapse = useOutlineStore((s) => s.toggleCollapse);
  const getPreviousVisibleInstance = useOutlineStore(
    (s) => s.getPreviousVisibleInstance,
  );
  const getNextVisibleInstance = useOutlineStore(
    (s) => s.getNextVisibleInstance,
  );

  return useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const sel = window.getSelection();
      const cursor = sel?.focusOffset ?? 0;

      if (isRef) {
        const structural =
          e.key === "Tab" ||
          (e.key === "Enter" && !e.shiftKey) ||
          ((e.key === "Backspace" || e.key === "Delete") &&
            (e.metaKey || e.ctrlKey)) ||
          (e.key === "Backspace" && cursor === 0) ||
          ((e.key === "ArrowUp" || e.key === "ArrowDown") &&
            e.metaKey &&
            e.shiftKey);
        if (structural) {
          e.preventDefault();
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void mutations.splitNode(nodeId, cursor);
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) void mutations.outdentNode(nodeId);
        else void mutations.indentNode(nodeId);
        return;
      }

      if (e.key === "Backspace" && !e.metaKey && !e.ctrlKey) {
        if (cursor === 0) {
          e.preventDefault();
          if (node?.text === "" && (node?.children.length ?? 0) === 0) {
            const prev = getPreviousVisibleInstance(instanceKey);
            void mutations.deleteNode(nodeId).then(() => {
              if (prev) {
                const prevNode = useOutlineStore
                  .getState()
                  .nodes.get(prev.nodeId);
                activateNode(
                  prev.nodeId,
                  prevNode?.text.length ?? 0,
                  prev.instanceKey,
                );
              }
            });
          } else {
            void mutations.mergeWithPrevious(nodeId);
          }
          return;
        }
      }

      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        (e.metaKey || e.ctrlKey)
      ) {
        e.preventDefault();
        void mutations.deleteNode(nodeId);
        return;
      }

      if (e.key === "ArrowUp") {
        if (e.metaKey && e.shiftKey) {
          e.preventDefault();
          void mutations.moveNodeUp(nodeId);
          return;
        }
        if (e.metaKey) {
          e.preventDefault();
          if (node?.children.length && !node.collapsed) {
            toggleCollapse(nodeId);
          }
          return;
        }
        if (cursor === 0) {
          e.preventDefault();
          const prev = getPreviousVisibleInstance(instanceKey);
          if (prev) {
            const prevNode = useOutlineStore.getState().nodes.get(prev.nodeId);
            activateNode(
              prev.nodeId,
              prevNode?.text.length ?? 0,
              prev.instanceKey,
            );
          }
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        useOutlineStore.getState().selectNode(nodeId, instanceKey);
        return;
      }

      if (e.key === "ArrowDown") {
        if (e.metaKey && e.shiftKey) {
          e.preventDefault();
          void mutations.moveNodeDown(nodeId);
          return;
        }
        if (e.metaKey) {
          e.preventDefault();
          if (node?.children.length && node.collapsed) {
            toggleCollapse(nodeId);
          }
          return;
        }
        const isAtEnd = cursor === (node?.text.length ?? 0);
        if (isAtEnd) {
          e.preventDefault();
          const next = getNextVisibleInstance(instanceKey);
          if (next) activateNode(next.nodeId, 0, next.instanceKey);
        }
        return;
      }
    },
    [
      nodeId,
      node,
      isRef,
      instanceKey,
      toggleCollapse,
      activateNode,
      getPreviousVisibleInstance,
      getNextVisibleInstance,
    ],
  );
}
