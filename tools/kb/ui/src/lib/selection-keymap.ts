/**
 * Selection-mode keymap (nxus / DESIGN-REFINE §2 W1).
 * Active only when a node is selected and not being edited.
 */
import type { VisibleInstance } from "@/lib/visible-instances";

export type SelectionKeyAction =
  | { type: "select"; nodeId: string; instanceKey: string }
  | { type: "clear" }
  | { type: "edit"; nodeId: string; instanceKey: string }
  | { type: "toggleCollapse"; nodeId: string }
  | { type: "createAfter"; nodeId: string }
  | { type: "delete"; nodeId: string; instanceKey: string };

export interface SelectionKeyContext {
  selectedNodeId: string | null;
  selectedInstanceKey: string | null;
  activeNodeId: string | null;
  getPreviousVisibleInstance: (
    instanceKey: string,
  ) => VisibleInstance | null;
  getNextVisibleInstance: (instanceKey: string) => VisibleInstance | null;
}

/** True when the event target is a text field / contentEditable (skip map). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[contenteditable='true']"));
}

/**
 * Map a keydown to a selection action, or null if not handled.
 * Caller should preventDefault when a non-null action is returned.
 */
export function mapSelectionKey(
  key: string,
  ctx: SelectionKeyContext,
): SelectionKeyAction | null {
  const { selectedNodeId, selectedInstanceKey, activeNodeId } = ctx;
  if (!selectedNodeId || !selectedInstanceKey || activeNodeId) return null;

  switch (key) {
    case "ArrowUp": {
      const prev = ctx.getPreviousVisibleInstance(selectedInstanceKey);
      return prev
        ? {
            type: "select",
            nodeId: prev.nodeId,
            instanceKey: prev.instanceKey,
          }
        : null;
    }
    case "ArrowDown": {
      const next = ctx.getNextVisibleInstance(selectedInstanceKey);
      return next
        ? {
            type: "select",
            nodeId: next.nodeId,
            instanceKey: next.instanceKey,
          }
        : null;
    }
    case "Enter":
      return {
        type: "edit",
        nodeId: selectedNodeId,
        instanceKey: selectedInstanceKey,
      };
    case " ":
    case "Space":
    case "Spacebar":
      return { type: "toggleCollapse", nodeId: selectedNodeId };
    case "o":
      return { type: "createAfter", nodeId: selectedNodeId };
    case "Backspace":
    case "Delete":
      return {
        type: "delete",
        nodeId: selectedNodeId,
        instanceKey: selectedInstanceKey,
      };
    case "Escape":
      return { type: "clear" };
    default:
      return null;
  }
}
