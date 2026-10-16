/**
 * What a command reads and drives of the page (`OutlineCommandApi`), read
 * now: the zoom, the scope and the graph from the graph store, the selection,
 * the rows and the reveal from the outline, and the frame views from
 * their port. Both palettes run commands against it, so the context is built
 * in one place.
 */
import type { OutlineCommandApi } from "@kb/ui-sdk";
import { providedFrameViews } from "@/stores/frame-views";
import { useGraphStore } from "@/stores/graph.store";
import { outlineNodes, useOutlineStore } from "@/stores/outline.store";

export function pageCommandApi(): OutlineCommandApi {
  const graph = useGraphStore.getState();
  const outline = useOutlineStore.getState();
  return {
    selectedNodeId: outline.selectedNodeId,
    rootNodeId: graph.rootNodeId,
    ontologyId: graph.ontologyId,
    nodes: outlineNodes(),
    wireNodes: graph.wireNodes,
    jumpToNode: outline.jumpToNode,
    zoomTo: graph.zoomTo,
    frameViews: providedFrameViews,
  };
}
