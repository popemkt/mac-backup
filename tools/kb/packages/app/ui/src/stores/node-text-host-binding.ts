import { useOutlineStore } from "@/stores/outline.store";
import { useRefNavigation } from "@/stores/ref-navigation";
import { useUiStore } from "@/stores/ui.store";

/**
 * Store half of the node text host binding.
 *
 * Every surface that renders the host calls this once and spreads the result;
 * the two mutation callbacks stay on the surface because stores may not import
 * actions. The reads are store-wide, so the hook takes no arguments — a
 * node-scoped read is the outline-store split's job, not a parameter here.
 */
export function useNodeTextHostBinding() {
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
