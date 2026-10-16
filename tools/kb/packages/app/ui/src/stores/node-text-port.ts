/**
 * The shell's stores as a node text port (`@kb/ui-sdk` → `NodeTextPort`):
 * the page's graph, its editor's half (`editorTextPort`: the caret hand-off,
 * the text-host registry and the selection), the node palette's switch, and
 * the page's follow. Every text host the shell draws is bound through it, and
 * the page's `BrowserHost` is built on it.
 */
import { editorTextPort, type NodeTextPort } from "@kb/ui-sdk";
import { followFrom } from "@/stores/follow";
import { pageGraph } from "@/stores/graph-read";
import { pageEditor } from "@/stores/page-editor";
import { useUiStore } from "@/stores/ui.store";

export const nodeTextPort: NodeTextPort = {
  ...pageGraph,
  ...editorTextPort(pageEditor),
  setNodePaletteOpen: (open) => useUiStore.getState().setNodePaletteOpen(open),
  follow: followFrom,
};
