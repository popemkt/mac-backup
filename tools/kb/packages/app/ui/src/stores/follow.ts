import { useCallback, useContext } from "react";
import { OpenNodeContext, type Follow, type FollowHow, type FollowTarget } from "@/lib/follow";
import { usePane } from "@/lib/pane";
import { nodePath } from "@/lib/router";
import { useOutlineStore } from "@/stores/outline.store";
import { useWorkspaceStore } from "@/stores/workspace.store";

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
  const open = useContext(OpenNodeContext);
  const pane = usePane();
  return useCallback<Follow>(
    (target, how) => followFrom({ pane, open }, target, how),
    [open, pane],
  );
}

/**
 * The body of a follow, outside React: from `pane`, opening a node with
 * `open` (`OpenNodeContext`), else the outline's zoom. `useFollow` and the
 * page's `BrowserHost` both carry a follow out through it.
 */
export function followFrom(
  at: { readonly pane: string; readonly open: ((id: string) => void) | null },
  target: FollowTarget,
  how: FollowHow,
): void {
  if (target.kind === "href") {
    window.open(target.href, "_blank", "noopener,noreferrer");
    return;
  }
  if (how === "beside") useWorkspaceStore.getState().openBeside(at.pane, nodePath(target.id));
  else if (how === "reveal") useOutlineStore.getState().jumpToNode(target.id);
  else (at.open ?? useOutlineStore.getState().zoomTo)(target.id);
}
