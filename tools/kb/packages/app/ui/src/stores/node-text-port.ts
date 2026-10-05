/**
 * The shell's stores as a node text port (`@kb/ui-sdk` → `NodeTextPort`):
 * the outline's graph, its caret hand-off and text-host registry, the node
 * palette's switch, and the page's follow. Every text host the shell draws is
 * bound through it, and the page's `BrowserHost` is built on it.
 */
import type { NodeTextPort } from "@kb/ui-sdk";
import { followFrom } from "@/stores/follow";
import { outlineGraph } from "@/stores/graph-read";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";

export const nodeTextPort: NodeTextPort = {
  ...outlineGraph,
  pendingCaret: (instanceKey) => {
    const caret = useOutlineStore.getState().pendingCaret;
    return caret?.instanceKey === instanceKey ? caret : null;
  },
  placeCaret: (instanceKey, at) => useOutlineStore.getState().placeCaret(instanceKey, at),
  consumeCaret: (instanceKey) => useOutlineStore.getState().consumeCaret(instanceKey),
  registerTextHost: (instanceKey) => useOutlineStore.getState().registerTextHost(instanceKey),
  unregisterTextHost: (instanceKey) => useOutlineStore.getState().unregisterTextHost(instanceKey),
  selectNode: (nodeId, instanceKey) => useOutlineStore.getState().selectNode(nodeId, instanceKey),
  setNodePaletteOpen: (open) => useUiStore.getState().setNodePaletteOpen(open),
  follow: followFrom,
};
