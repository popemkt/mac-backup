/**
 * What a command reads and drives of the page (`OutlineCommandApi`), read
 * now: the zoom, the scope and the graph from the graph store, the rows and
 * the reveal from the projection the page stands in, the selection from its
 * editor, and the frame views from the UI kernel. Both palettes run commands against it, so the context is built
 * in one place.
 */
import type { OutlineCommandApi } from "@kb/ui-sdk";
import { pageProjection, useGraphStore } from "@/stores/graph.store";
import { pageRows } from "@/stores/page";
import { pageEditor } from "@/stores/page-editor";
import { providedFrameViews } from "@kb/ui-sdk";

export function pageCommandApi(): OutlineCommandApi {
  const graph = useGraphStore.getState();
  return {
    selectedNodeId: pageEditor().getState().selectedNodeId,
    rootNodeId: graph.rootNodeId,
    ontologyId: graph.ontologyId,
    nodes: pageRows(),
    wireNodes: graph.wireNodes,
    jumpToNode: pageProjection().reveal,
    zoomTo: graph.zoomTo,
    frameViews: providedFrameViews,
  };
}
