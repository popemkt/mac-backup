/**
 * The graph's isomorphic projection: the edges of a node set by kind, the
 * spanning tree the tree renderers draw, and the perspective a graph view
 * node is read as. The browser's renderers and lens, and any read on the
 * server, run these same functions. It is the graph visualisation's shared
 * code, not the page's live replica (the graph store), which is core.
 */
export { collectEdges, type LensEdge, type LensSource } from "./edges.ts";
export { buildTreeForest, type LensTreeNode, type LensTreeSource } from "./tree.ts";
export { decodePerspective, resolvePerspective } from "./perspective.ts";
