import { SCREEN_APPLIED, screenRejected, type ScreenAck } from "@kb/contracts";
import { usePaneScreen, type PaneSelection } from "@/stores/screen.store";
import { useOutlineStore } from "@/stores/outline.store";

/**
 * A `ui.select` in the outline. The outline selects one row at a time, so a
 * selection is empty (clear it) or one node, which must be in the open
 * outline; a focus puts the caret on a node, revealing it first.
 */
function selectInOutline({ selection, focus }: PaneSelection): ScreenAck {
  const outline = useOutlineStore.getState();
  if (selection !== undefined) {
    if (selection.length > 1) return screenRejected("the outline selects one node at a time");
    const [id] = selection;
    if (id === undefined) {
      outline.selectNode(null);
    } else {
      outline.expandAncestors(id);
      if (!useOutlineStore.getState().getVisibleNodes().includes(id)) {
        return screenRejected(`${id} is not in the open outline; navigate to it first`);
      }
      outline.selectNode(id);
    }
  }
  if (focus !== undefined) {
    useOutlineStore.getState().jumpToNode(focus);
    const after = useOutlineStore.getState();
    if (after.activeNodeId !== focus && after.selectedNodeId !== focus) {
      return screenRejected(`the outline cannot focus ${focus}`);
    }
  }
  return SCREEN_APPLIED;
}

/** Report the outline's part of the screen: its zoom root, the row being edited, the selected row. */
export function useOutlineScreen(): void {
  const subject = useOutlineStore((s) => s.rootNodeId);
  const focused = useOutlineStore((s) => s.activeNodeId);
  const selected = useOutlineStore((s) => s.selectedNodeId);
  usePaneScreen(
    { subject, focused, selection: selected === null ? [] : [selected] },
    selectInOutline,
  );
}
