/**
 * The graph visualisation's shared code: its view keys (the graph page, the
 * renderers and a node's neighbourhood), and its isomorphic projection — the
 * edges of a node set by kind, the spanning tree the tree renderers draw,
 * the perspective a graph view node is read as, and the lens its settings
 * decode by. The browser's renderers and lens, and the server's catalog and
 * any read on it, use these same values. It is not the page's live replica (the graph store), which is core.
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
export {
  DEFAULT_AUTOROTATE,
  DEFAULT_CLUSTER_BY,
  DEFAULT_COLOR_BY,
  DEFAULT_FIXED_COLOR,
  DEFAULT_EDGE_KINDS,
  DEFAULT_LABEL_DENSITY,
  DEFAULT_LAYOUT,
  DEFAULT_LINK_DISTANCE,
  DEFAULT_LINK_STYLE,
  DEFAULT_MAX_NODES,
  DEFAULT_RENDERER,
  DEFAULT_SHOW_LABELS,
  DEFAULT_SIZE_BY,
  DEFAULT_SPREAD,
  DEFAULT_THEME,
  EdgeKindSchema,
  LENS_LABEL_DENSITIES,
  LENS_LAYOUTS,
  LENS_LINK_STYLES,
  LENS_SETTINGS,
  LENS_THEMES,
  decodeLensConfig,
  encodeLensConfig,
  perspectiveProps,
  sourceValue,
  type EdgeKind,
  type LensLabelDensity,
  type LensLayout,
  type LensLinkStyle,
  type LensPerspective,
  type LensProps,
  type LensRenderer,
  type LensSetting,
  type LensTheme,
  type LensWrite,
} from "./lens.ts";
