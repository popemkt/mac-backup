import { useOutlineStore } from "@/stores/outline.store";
import { useRefNavigation } from "@/stores/ref-navigation";
import { useUiStore } from "@/stores/ui.store";

/**
 * Store half of the node text host binding.
 *
 * Every surface that renders the host calls this with the host's `nodeId`
 * and `instanceKey` — the same pair it uses for the mutation callbacks
 * stores cannot import. The reads themselves are not node-scoped yet;
 * the arguments pin the call site so a later split cannot grow a second hook.
 */
export function useNodeTextHostBinding(nodeId: string, instanceKey?: string) {
  const nodes = useOutlineStore((s) => s.nodes);
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const pendingCaret = useOutlineStore((s) => s.pendingCaret);
  const consumeCaret = useOutlineStore((s) => s.consumeCaret);
  const placeCaret = useOutlineStore((s) => s.placeCaret);
  const selectNode = useOutlineStore((s) => s.selectNode);
  const registerTextHost = useOutlineStore((s) => s.registerTextHost);
  const unregisterTextHost = useOutlineStore((s) => s.unregisterTextHost);
  const setNodePaletteOpen = useUiStore((s) => s.setNodePaletteOpen);
  const onRefClick = useRefNavigation();

  return {
    nodeId,
    instanceKey,
    nodes,
    zoomTo,
    pendingCaret,
    onRefClick,
    consumeCaret,
    placeCaret,
    selectNode,
    registerTextHost,
    unregisterTextHost,
    setNodePaletteOpen,
  };
}
