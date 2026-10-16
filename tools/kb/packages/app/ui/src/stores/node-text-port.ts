/**
 * The shell's stores as a node text port (`@kb/ui-sdk` → `NodeTextPort`):
 * the page's graph, its editor's caret hand-off, text-host registry and
 * selection, the node palette's switch, and the page's follow. Every text host the shell draws is
 * bound through it, and the page's `BrowserHost` is built on it.
 */
import type { NodeTextPort } from "@kb/ui-sdk";
import { followFrom } from "@/stores/follow";
import { pageGraph } from "@/stores/graph-read";
import { pageEditor } from "@/stores/page-editor";
import { useUiStore } from "@/stores/ui.store";

export const nodeTextPort: NodeTextPort = {
  ...pageGraph,
  pendingCaret: (instanceKey) => {
    const caret = pageEditor().getState().pendingCaret;
    return caret?.instanceKey === instanceKey ? caret : null;
  },
  placeCaret: (instanceKey, at) => pageEditor().getState().placeCaret(instanceKey, at),
  consumeCaret: (instanceKey) => pageEditor().getState().consumeCaret(instanceKey),
  registerTextHost: (instanceKey) => pageEditor().getState().registerTextHost(instanceKey),
  unregisterTextHost: (instanceKey) => pageEditor().getState().unregisterTextHost(instanceKey),
  selectNode: (nodeId, instanceKey) => pageEditor().getState().selectNode(nodeId, instanceKey),
  setNodePaletteOpen: (open) => useUiStore.getState().setNodePaletteOpen(open),
  follow: followFrom,
};
