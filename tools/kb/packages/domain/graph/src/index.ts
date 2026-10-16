/**
 * The graph visualisation's shared code: its view keys (the graph page, the
 * renderers and a node's neighbourhood), and its isomorphic projection — the
 * edges of a node set by kind, the spanning tree the tree renderers draw,
 * and the perspective a graph view node is read as. The browser's renderers
 * and lens, and the server's catalog and any read on it, use these same
 * values. It is not the page's live replica (the graph store), which is core.
 */
export {
  ClusterView,
  Force2dView,
  Force3dView,
  GRAPH_NAMESPACE,
  GraphParams,
  GraphView,
  NeighbourhoodParams,
  NeighbourhoodView,
  TreeView,
  TreemapView,
  isRendererKey,
  type GraphChannel,
  type RendererCapabilities,
  type RendererKey,
  type RendererTraits,
} from "./views.ts";
export { collectEdges, type LensEdge, type LensSource } from "./edges.ts";
export { buildTreeForest, type LensTreeNode, type LensTreeSource } from "./tree.ts";
export { decodePerspective, resolvePerspective } from "./perspective.ts";
