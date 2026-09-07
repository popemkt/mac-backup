import { useCallback } from "react";
import { useOutlineStore } from "@/stores/outline.store";

/**
 * Clicking an inline `[[id]]` reference navigates: zoom to it, or jump to it
 * in place when the modifier is held.
 *
 * It lives beside the store rather than with the component that renders the
 * link because `MdView` is a primitive — it takes the handler as a prop the
 * way `TagChip` and `NodeRow` take theirs — and every surface that renders
 * markdown wants the same navigation. One owner, four call sites.
 */
export function useRefNavigation(): (e: React.MouseEvent, id: string) => void {
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const jumpToNode = useOutlineStore((s) => s.jumpToNode);
  return useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.metaKey || e.ctrlKey) jumpToNode(id);
      else zoomTo(id);
    },
    [jumpToNode, zoomTo],
  );
}
