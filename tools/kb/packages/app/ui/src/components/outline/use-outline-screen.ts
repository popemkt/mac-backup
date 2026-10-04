import { useCallback } from "react";
import { SCREEN_APPLIED, screenRejected, type ScreenAck } from "@kb/contracts";
import { outlineInstanceKey, type PaneCommand, type PaneSelection } from "@kb/ui-sdk";
import { usePaneScreen } from "@/stores/screen.store";
import { useOutlineStore } from "@/stores/outline.store";
import { outlineHostOfInstance } from "@/stores/outline-hosts";
import { useOutlineHost } from "./outline-host";

/**
 * A `ui.select` in the outline of host `host`. The outline selects one row at
 * a time, so a selection is empty (clear it) or one node, which must be in
 * that outline; a focus puts the caret on a node, revealing it first.
 */
function selectInOutline(
  host: string,
  zoomed: boolean,
  { selection, focus }: PaneSelection,
): ScreenAck {
  const outline = useOutlineStore.getState();
  // The node's row in this outline: its place in the tree, else where a query shows it.
  const rowOf = (id: string): string | undefined => {
    const rows = useOutlineStore.getState().getVisibleInstances(host);
    const key = outlineInstanceKey(id, useOutlineStore.getState().nodes, host);
    return (rows.find((row) => row.instanceKey === key) ?? rows.find((row) => row.nodeId === id))
      ?.instanceKey;
  };
  if (selection !== undefined) {
    if (selection.length > 1) return screenRejected("the outline selects one node at a time");
    const [id] = selection;
    if (id === undefined) {
      outline.selectNode(null);
    } else {
      outline.expandAncestors(id);
      const key = rowOf(id);
      if (key === undefined) {
        return screenRejected(`${id} is not in the open outline; navigate to it first`);
      }
      useOutlineStore.getState().selectNode(id, key);
    }
  }
  if (focus !== undefined) {
    if (zoomed) {
      // The zoom goes home first when the node is not under it.
      useOutlineStore.getState().jumpToNode(focus);
    } else {
      useOutlineStore.getState().expandAncestors(focus);
      const key = rowOf(focus);
      if (key !== undefined) useOutlineStore.getState().activateNode(focus, 0, key);
    }
    const after = useOutlineStore.getState();
    if (after.activeNodeId !== focus && after.selectedNodeId !== focus) {
      return screenRejected(`the outline cannot focus ${focus}`);
    }
  }
  return SCREEN_APPLIED;
}

/**
 * Report the outline's part of its pane's screen: the node it is rooted at
 * (its own root, or the zoom), and the row being edited and the selected row
 * when they are this outline's.
 */
export function useOutlineScreen(root: string | undefined): void {
  const host = useOutlineHost();
  const zoomRoot = useOutlineStore((s) => s.rootNodeId);
  const focused = useOutlineStore((s) =>
    outlineHostOfInstance(s.activeInstanceKey) === host ? s.activeNodeId : null,
  );
  const selected = useOutlineStore((s) =>
    outlineHostOfInstance(s.selectedInstanceKey) === host ? s.selectedNodeId : null,
  );
  const carryOut = useCallback(
    (command: PaneCommand) =>
      command.kind === "select"
        ? selectInOutline(host, root === undefined, command)
        : screenRejected("the outline has no camera to point"),
    [host, root],
  );
  usePaneScreen(
    { subject: root ?? zoomRoot, focused, selection: selected === null ? [] : [selected] },
    carryOut,
  );
}
