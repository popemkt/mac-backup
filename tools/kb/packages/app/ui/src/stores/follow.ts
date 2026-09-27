import { useCallback } from "react";
import type { Follow } from "@/lib/follow";
import { useOutlineStore } from "@/stores/outline.store";

/**
 * Carry out a follow (`lib/follow`): a node opens as the page, or is revealed
 * in place; a location outside the graph opens in a new tab.
 *
 * It lives beside the store rather than with a component because the
 * surfaces that render pointers — `MdView`, the node text host, a value slot —
 * are primitives: they take the handler as a prop, and every surface wants the
 * same one. One owner, every call site.
 */
export function useFollow(): Follow {
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const jumpToNode = useOutlineStore((s) => s.jumpToNode);
  return useCallback<Follow>(
    (target, how) => {
      if (target.kind === "href") {
        window.open(target.href, "_blank", "noopener,noreferrer");
        return;
      }
      if (how === "reveal") jumpToNode(target.id);
      else zoomTo(target.id);
    },
    [jumpToNode, zoomTo],
  );
}
