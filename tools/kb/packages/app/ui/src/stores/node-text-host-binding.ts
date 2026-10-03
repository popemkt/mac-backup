import { useGraphRead } from "@/stores/graph-read";
import { useOutlineStore } from "@/stores/outline.store";
import { useFollow } from "@/stores/follow";
import { useUiStore } from "@/stores/ui.store";

/**
 * Store half of the node text host binding.
 *
 * Every surface that renders the host calls this once and spreads the result;
 * the two mutation callbacks stay on the surface because stores may not import
 * actions. The reads are the host's own: the graph through a `GraphRead`, so
 * the host re-renders when a node it read changes (its text's references, the
 * schema it resolves), and the caret placement only when it is addressed to
 * `instanceKey`.
 */
export function useNodeTextHostBinding(instanceKey: string | undefined) {
  const { outline, schema } = useGraphRead();
  const pendingCaret = useOutlineStore((s) =>
    instanceKey !== undefined && s.pendingCaret?.instanceKey === instanceKey
      ? s.pendingCaret
      : null,
  );
  const consumeCaret = useOutlineStore((s) => s.consumeCaret);
  const placeCaret = useOutlineStore((s) => s.placeCaret);
  const selectNode = useOutlineStore((s) => s.selectNode);
  const registerTextHost = useOutlineStore((s) => s.registerTextHost);
  const unregisterTextHost = useOutlineStore((s) => s.unregisterTextHost);
  const setNodePaletteOpen = useUiStore((s) => s.setNodePaletteOpen);
  const onFollow = useFollow();

  return {
    nodes: outline,
    schema,
    pendingCaret,
    onFollow,
    consumeCaret,
    placeCaret,
    selectNode,
    registerTextHost,
    unregisterTextHost,
    setNodePaletteOpen,
  };
}
