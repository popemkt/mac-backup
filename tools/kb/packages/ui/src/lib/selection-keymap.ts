/**
 * Selection-mode keymap (nxus / DESIGN-REFINE §2 W1; r1 §3.2 Mode B).
 * Active only when a node is selected and not being edited.
 */
import type { VisibleInstance } from "@/lib/visible-instances";

export interface SelectionKeyEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export type SelectionKeyAction =
  | { type: "select"; nodeId: string; instanceKey: string }
  | { type: "clear" }
  | { type: "edit"; nodeId: string; instanceKey: string }
  | { type: "toggleCollapse"; nodeId: string }
  | { type: "collapse"; nodeId: string }
  | { type: "expand"; nodeId: string }
  | { type: "selectParent"; nodeId: string }
  | { type: "selectFirstChild"; nodeId: string }
  | { type: "indent"; nodeId: string }
  | { type: "outdent"; nodeId: string }
  | { type: "moveUp"; nodeId: string }
  | { type: "moveDown"; nodeId: string }
  | { type: "zoom"; nodeId: string }
  | { type: "createAfter"; nodeId: string }
  | { type: "createBefore"; nodeId: string }
  | { type: "delete"; nodeId: string; instanceKey: string }
  | { type: "append"; nodeId: string; instanceKey: string; char: string };

export interface SelectionNodeInfo {
  collapsed: boolean;
  childIds: string[];
  parentId: string | null;
}

export interface SelectionKeyContext {
  selectedNodeId: string | null;
  selectedInstanceKey: string | null;
  activeNodeId: string | null;
  getPreviousVisibleInstance: (
    instanceKey: string,
  ) => VisibleInstance | null;
  getNextVisibleInstance: (
    instanceKey: string,
  ) => VisibleInstance | null;
  getNode?: (id: string) => SelectionNodeInfo | undefined;
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
  ev: SelectionKeyEvent,
  ctx: SelectionKeyContext,
): SelectionKeyAction | null {
  const { selectedNodeId, selectedInstanceKey, activeNodeId } = ctx;
  if (!selectedNodeId || !selectedInstanceKey || activeNodeId) return null;

  const mod = ev.metaKey || ev.ctrlKey;
  const info = ctx.getNode?.(selectedNodeId);
  const id = selectedNodeId;

  // Modifier combos first.
  if (mod && ev.shiftKey && ev.key === "ArrowUp") {
    return { type: "moveUp", nodeId: id };
  }
  if (mod && ev.shiftKey && ev.key === "ArrowDown") {
    return { type: "moveDown", nodeId: id };
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.key === ".") {
    return { type: "zoom", nodeId: id };
  }
  if (mod) return null;

  switch (ev.key) {
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
    case "ArrowLeft": {
      if (!info) return null;
      if (!info.collapsed && info.childIds.length > 0) {
        return { type: "collapse", nodeId: id };
      }
      return info.parentId
        ? { type: "selectParent", nodeId: id }
        : null;
    }
    case "ArrowRight": {
      if (!info) return null;
      if (info.collapsed && info.childIds.length > 0) {
        return { type: "expand", nodeId: id };
      }
      return info.childIds.length > 0
        ? { type: "selectFirstChild", nodeId: id }
        : null;
    }
    case "Enter":
      return { type: "edit", nodeId: id, instanceKey: selectedInstanceKey };
    case " ":
    case "Space":
    case "Spacebar":
      return { type: "toggleCollapse", nodeId: id };
    case "Tab":
      return ev.shiftKey
        ? { type: "outdent", nodeId: id }
        : { type: "indent", nodeId: id };
    case "o":
      return { type: "createAfter", nodeId: id };
    case "O":
      // Shift+o: new empty row directly above.
      return { type: "createBefore", nodeId: id };
    case "Backspace":
    case "Delete":
      return { type: "delete", nodeId: id, instanceKey: selectedInstanceKey };
    case "Escape":
      return { type: "clear" };
    default: {
      const k = ev.key;
      if (
        k.length === 1 &&
        !ev.metaKey &&
        !ev.ctrlKey &&
        !ev.altKey &&
        k !== " "
      ) {
        return {
          type: "append",
          nodeId: id,
          instanceKey: selectedInstanceKey,
          char: k,
        };
      }
      return null;
    }
  }
}
