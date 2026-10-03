import { createContext, useCallback, useContext } from "react";
import type { Follow } from "@/lib/follow";
import { usePane } from "@/lib/pane";
import { nodePath } from "@/lib/router";
import { useOutlineStore } from "@/stores/outline.store";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * How the page around a point opens a node as its page, where that is not
 * the outline's zoom: an outline rooted at a node in its pane moves its pane
 * to the node instead. None means the zoom.
 */
export const OpenNodeContext = createContext<((id: string) => void) | null>(null);

/** Open a node as the page around the caller: its pane's location, or the zoom. */
export function useOpenNode(): (id: string) => void {
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  return useContext(OpenNodeContext) ?? zoomTo;
}

/**
 * Carry out a follow (`lib/follow`): a node opens as the pane's page, is
 * revealed in place, or opens in a new pane beside this one; a location
 * outside the graph opens in a new tab.
 *
 * It lives beside the store rather than with a component because the
 * surfaces that render pointers — `MdView`, the node text host, a value slot —
 * are primitives: they take the handler as a prop, and every surface wants the
 * same one. One owner, every call site.
 */
export function useFollow(): Follow {
  const jumpToNode = useOutlineStore((s) => s.jumpToNode);
  const openBeside = useWorkspaceStore((s) => s.openBeside);
  const open = useOpenNode();
  const pane = usePane();
  return useCallback<Follow>(
    (target, how) => {
      if (target.kind === "href") {
        window.open(target.href, "_blank", "noopener,noreferrer");
        return;
      }
      if (how === "beside") openBeside(pane, nodePath(target.id));
      else if (how === "reveal") jumpToNode(target.id);
      else open(target.id);
    },
    [jumpToNode, open, openBeside, pane],
  );
}
